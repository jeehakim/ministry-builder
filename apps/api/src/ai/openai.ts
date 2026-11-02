import OpenAI from "openai";
import type { z } from "zod";
import { AiProviderError, type AiCallUsage, type AiProvider } from "./provider";
import {
  altSystemPrompt,
  altUserText,
  campaignStorySystemPrompt,
  campaignStoryUserText,
  draftSystemPrompt,
  draftUserText,
  rewriteSystemPrompt,
  rewriteUserText,
  thankYouSystemPrompt,
  thankYouUserText,
  themeSystemPrompt,
  themeUserText,
  translateSystemPrompt,
  translateUserText,
} from "./prompts";
import { AltOutput, CampaignStoryOutput, draftOutputSchema, RewriteOutput, ThankYouOutput, ThemeOutput, translationOutputSchema } from "./schemas";
import { extractTranslatable, isEmptyTranslatable } from "./translatable";

type ContentPart = OpenAI.Chat.Completions.ChatCompletionContentPart;
type Message = OpenAI.Chat.Completions.ChatCompletionMessageParam;

const PROVIDER = "openai";
const DRAFT_TIMEOUT_MS = 120_000;
const SMALL_TIMEOUT_MS = 45_000;
/** Reasoning tokens count toward this cap, so leave room beyond the visible JSON. */
const DRAFT_MAX_COMPLETION_TOKENS = 32_000;
const SMALL_MAX_COMPLETION_TOKENS = 8_000;
const TRANSLATE_TIMEOUT_MS = 90_000;
const TRANSLATE_MAX_COMPLETION_TOKENS = 16_000;

const FRIENDLY_UNAVAILABLE = "The AI service is unavailable right now. Please try again in a moment.";
const FRIENDLY_BAD_OUTPUT = "The AI returned an answer we could not use. Please try again.";

export type OpenAiProviderOptions = {
  apiKey: string;
  model: string;
  /** Source of vision inputs (design references, alt text). */
  images: R2Bucket;
  /** Test seam: a pre-built client. */
  client?: OpenAI;
};

function describeIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 12)
    .map((issue) => `- ${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("\n");
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function contentTypeFor(key: string, declared: string | undefined): string {
  if (declared?.startsWith("image/")) return declared;
  if (key.endsWith(".png")) return "image/png";
  if (key.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

export function createOpenAiProvider(options: OpenAiProviderOptions): AiProvider {
  const client = options.client ?? new OpenAI({ apiKey: options.apiKey, maxRetries: 2, timeout: SMALL_TIMEOUT_MS });
  const model = options.model;

  async function imagePart(key: string): Promise<ContentPart> {
    const object = await options.images.get(key);
    if (!object) throw new AiProviderError("The image could not be found.", { key });
    const bytes = new Uint8Array(await object.arrayBuffer());
    const type = contentTypeFor(key, object.httpMetadata?.contentType);
    return { type: "image_url", image_url: { url: `data:${type};base64,${toBase64(bytes)}` } };
  }

  async function complete(messages: Message[], timeout: number, maxTokens: number) {
    try {
      const response = await client.chat.completions.create(
        {
          model,
          messages,
          response_format: { type: "json_object" },
          max_completion_tokens: maxTokens,
        },
        { timeout },
      );
      const choice = response.choices[0];
      if (!choice) throw new AiProviderError(FRIENDLY_BAD_OUTPUT, { reason: "no choices" });
      if (choice.message.refusal) throw new AiProviderError(FRIENDLY_BAD_OUTPUT, { refusal: choice.message.refusal });
      return {
        content: choice.message.content ?? "",
        finishReason: choice.finish_reason,
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
      };
    } catch (err) {
      if (err instanceof AiProviderError) throw err;
      throw new AiProviderError(FRIENDLY_UNAVAILABLE, err);
    }
  }

  /**
   * One call plus at most one repair round. The model's JSON is validated with the
   * schema; on failure it gets the Zod issues and its own previous output once.
   */
  async function run<S extends z.ZodTypeAny>(args: {
    system: string;
    user: ContentPart[];
    schema: S;
    timeout: number;
    maxTokens: number;
  }): Promise<{ data: z.output<S>; usage: AiCallUsage }> {
    const messages: Message[] = [
      { role: "system", content: args.system },
      { role: "user", content: args.user },
    ];
    let inputTokens = 0;
    let outputTokens = 0;

    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await complete(messages, args.timeout, args.maxTokens);
      inputTokens += result.inputTokens;
      outputTokens += result.outputTokens;

      let problem: string;
      try {
        const parsed = args.schema.safeParse(JSON.parse(result.content));
        if (parsed.success) {
          return { data: parsed.data, usage: { inputTokens, outputTokens, model, provider: PROVIDER } };
        }
        problem = `The JSON did not match the required shape:\n${describeIssues(parsed.error)}`;
      } catch {
        problem =
          result.finishReason === "length"
            ? "The output was cut off before the JSON was complete. Return a shorter but complete JSON object."
            : "The output was not valid JSON.";
      }

      if (attempt === 1) {
        throw new AiProviderError(FRIENDLY_BAD_OUTPUT, { problem, inputTokens, outputTokens });
      }
      messages.push(
        { role: "assistant", content: result.content },
        { role: "user", content: `${problem}\n\nReturn the complete corrected JSON object only.` },
      );
    }
    throw new AiProviderError(FRIENDLY_BAD_OUTPUT);
  }

  return {
    async draft(input) {
      const reference = input.referenceAssetKey ? await imagePart(input.referenceAssetKey) : null;
      const user: ContentPart[] = [{ type: "text", text: draftUserText(input, reference !== null) }];
      if (reference) user.push(reference);
      const { data, usage } = await run({
        system: draftSystemPrompt(input),
        user,
        schema: draftOutputSchema(input.variations),
        timeout: DRAFT_TIMEOUT_MS,
        maxTokens: DRAFT_MAX_COMPLETION_TOKENS,
      });
      return { variations: data.variations, usage };
    },

    async rewrite(input) {
      const { data, usage } = await run({
        system: rewriteSystemPrompt(),
        user: [{ type: "text", text: rewriteUserText(input) }],
        schema: RewriteOutput,
        timeout: SMALL_TIMEOUT_MS,
        maxTokens: SMALL_MAX_COMPLETION_TOKENS,
      });
      return { text: data.text, usage };
    },

    async theme(input) {
      const reference = input.referenceAssetKey ? await imagePart(input.referenceAssetKey) : null;
      const user: ContentPart[] = [{ type: "text", text: themeUserText(input, reference !== null) }];
      if (reference) user.push(reference);
      const { data, usage } = await run({
        system: themeSystemPrompt(input),
        user,
        schema: ThemeOutput,
        timeout: SMALL_TIMEOUT_MS,
        maxTokens: SMALL_MAX_COMPLETION_TOKENS,
      });
      return { theme: data.theme, rationale: data.rationale, usage };
    },

    async altText(input) {
      const image = await imagePart(input.assetKey);
      const { data, usage } = await run({
        system: altSystemPrompt(),
        user: [{ type: "text", text: altUserText(input.orgName) }, image],
        schema: AltOutput,
        timeout: SMALL_TIMEOUT_MS,
        maxTokens: SMALL_MAX_COMPLETION_TOKENS,
      });
      return { alt: data.alt, usage };
    },

    async campaignStory(input) {
      const { data, usage } = await run({
        system: campaignStorySystemPrompt(input),
        user: [{ type: "text", text: campaignStoryUserText(input) }],
        schema: CampaignStoryOutput,
        timeout: SMALL_TIMEOUT_MS,
        maxTokens: SMALL_MAX_COMPLETION_TOKENS,
      });
      return { title: data.title, summary: data.summary, story: data.story, usage };
    },

    async thankYou(input) {
      const { data, usage } = await run({
        system: thankYouSystemPrompt(input),
        user: [{ type: "text", text: thankYouUserText(input) }],
        schema: ThankYouOutput,
        timeout: SMALL_TIMEOUT_MS,
        maxTokens: SMALL_MAX_COMPLETION_TOKENS,
      });
      return { message: data.message, usage };
    },

    async translate(input) {
      const source = extractTranslatable(input.document);
      if (isEmptyTranslatable(source)) {
        return { overlay: { meta: {}, sections: {} }, usage: { inputTokens: 0, outputTokens: 0, model, provider: PROVIDER } };
      }
      const { data, usage } = await run({
        system: translateSystemPrompt(input.sourceLanguage, input.targetLanguage),
        user: [{ type: "text", text: translateUserText(source) }],
        schema: translationOutputSchema(source),
        timeout: TRANSLATE_TIMEOUT_MS,
        maxTokens: TRANSLATE_MAX_COMPLETION_TOKENS,
      });
      return { overlay: data, usage };
    },
  };
}
