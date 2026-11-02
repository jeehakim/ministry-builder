import Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { AiProviderError, type AiCallUsage, type AiProvider } from "./provider";
import {
  addSectionSystemPrompt,
  addSectionUserText,
  altSystemPrompt,
  altUserText,
  draftSystemPrompt,
  draftUserText,
  editSystemPrompt,
  editUserText,
  rewriteSystemPrompt,
  rewriteUserText,
  themeSystemPrompt,
  themeUserText,
  translateSystemPrompt,
  translateUserText,
} from "./prompts";
import { AddSectionOutput, AltOutput, draftOutputSchema, editOutputSchema, RewriteOutput, ThemeOutput, translationOutputSchema } from "./schemas";
import { extractTranslatable, isEmptyTranslatable } from "./translatable";

type ContentPart = Anthropic.TextBlockParam | Anthropic.ImageBlockParam;
type Message = Anthropic.MessageParam;
type ImageMediaType = Anthropic.Base64ImageSource["media_type"];
type JsonSchema = Record<string, unknown>;

const PROVIDER = "anthropic";
/** Used when the ANTHROPIC_MODEL var is unset. Override with a cheaper model (e.g. claude-sonnet-5-5) if cost matters more. */
export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5-5";
/** Requests stream, so these bound the wait for the first byte; total time is bounded by max_tokens. */
const DRAFT_TIMEOUT_MS = 120_000;
const SMALL_TIMEOUT_MS = 45_000;
/** Thinking tokens count toward this cap, so leave room beyond the visible JSON. */
const DRAFT_MAX_TOKENS = 32_000;
const SMALL_MAX_TOKENS = 8_000;
const TRANSLATE_TIMEOUT_MS = 90_000;
const TRANSLATE_MAX_TOKENS = 16_000;
/** A page-wide edit may return several sections; a scoped one is small. */
const PAGE_EDIT_MAX_TOKENS = 16_000;

const FRIENDLY_UNAVAILABLE = "The AI service is unavailable right now. Please try again in a moment.";
const FRIENDLY_BAD_OUTPUT = "The AI returned an answer we could not use. Please try again.";

export type AnthropicProviderOptions = {
  apiKey: string;
  model: string;
  /** Source of vision inputs (design references, alt text). */
  images: R2Bucket;
  /** Test seam: a pre-built client. */
  client?: Anthropic;
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

function contentTypeFor(key: string, declared: string | undefined): ImageMediaType {
  if (declared === "image/png" || declared === "image/webp" || declared === "image/gif" || declared === "image/jpeg") {
    return declared;
  }
  if (key.endsWith(".png")) return "image/png";
  if (key.endsWith(".webp")) return "image/webp";
  if (key.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
}

/** Keywords structured outputs accept as-is (besides the containers handled explicitly). */
const SUPPORTED_KEYWORDS = new Set(["type", "required", "enum", "const", "default", "description", "title"]);

/**
 * Narrows a JSON Schema produced by zod-to-json-schema to the subset the Claude API
 * enforces as a grammar: objects always get `additionalProperties: false`, `enum` and
 * `const` stay so the section discriminator is enforced, and constraints the grammar
 * cannot express (string lengths, array counts beyond minItems 0/1, numeric ranges)
 * move into the description. Zod still checks the full schema on the way back.
 *
 * The SDK's own transform drops `enum`/`const` into the description as well, which
 * would leave the eight section types unenforced; hence this local variant.
 */
export function toStructuredOutputSchema(schema: JsonSchema): JsonSchema {
  const out: JsonSchema = {};
  const dropped: string[] = [];
  for (const [key, value] of Object.entries(schema)) {
    if (key === "$schema" || key === "additionalProperties") continue;
    if (key === "properties") {
      out.properties = Object.fromEntries(
        Object.entries(value as Record<string, JsonSchema>).map(([name, prop]) => [name, toStructuredOutputSchema(prop)]),
      );
    } else if (key === "items" && !Array.isArray(value)) {
      out.items = toStructuredOutputSchema(value as JsonSchema);
    } else if ((key === "anyOf" || key === "oneOf") && Array.isArray(value)) {
      out.anyOf = (value as JsonSchema[]).map(toStructuredOutputSchema);
    } else if (key === "minItems" && (value === 0 || value === 1)) {
      out.minItems = value;
    } else if (SUPPORTED_KEYWORDS.has(key)) {
      out[key] = value;
    } else {
      dropped.push(`${key}: ${JSON.stringify(value)}`);
    }
  }
  if (schema.type === "object") out.additionalProperties = false;
  if (dropped.length > 0) {
    const hint = `{${dropped.join(", ")}}`;
    out.description = typeof out.description === "string" ? `${out.description}\n\n${hint}` : hint;
  }
  return out;
}

function outputFormat(schema: z.ZodTypeAny): Anthropic.JSONOutputFormat {
  const json = zodToJsonSchema(schema, { $refStrategy: "none" }) as JsonSchema;
  return { type: "json_schema", schema: toStructuredOutputSchema(json) };
}

export function createAnthropicProvider(options: AnthropicProviderOptions): AiProvider {
  const client =
    options.client ?? new Anthropic({ apiKey: options.apiKey, maxRetries: 2, timeout: SMALL_TIMEOUT_MS });
  const model = options.model;

  async function imagePart(key: string): Promise<ContentPart> {
    const object = await options.images.get(key);
    if (!object) throw new AiProviderError("The image could not be found.", { key });
    const bytes = new Uint8Array(await object.arrayBuffer());
    const media_type = contentTypeFor(key, object.httpMetadata?.contentType);
    return { type: "image", source: { type: "base64", media_type, data: toBase64(bytes) } };
  }

  async function complete(args: {
    system: string;
    messages: Message[];
    format: Anthropic.JSONOutputFormat;
    timeout: number;
    maxTokens: number;
  }) {
    try {
      // Streaming keeps long drafts clear of the non-streaming request limits; the
      // accumulated message is all we need.
      const response = await client.messages
        .stream(
          {
            model,
            max_tokens: args.maxTokens,
            system: args.system,
            messages: args.messages,
            output_config: { format: args.format },
          },
          { timeout: args.timeout },
        )
        .finalMessage();
      if (response.stop_reason === "refusal") {
        throw new AiProviderError(FRIENDLY_BAD_OUTPUT, { refusal: response.stop_details });
      }
      const usage = response.usage;
      return {
        content: response.content
          .filter((block): block is Anthropic.TextBlock => block.type === "text")
          .map((block) => block.text)
          .join(""),
        stopReason: response.stop_reason,
        inputTokens: usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0),
        outputTokens: usage.output_tokens,
      };
    } catch (err) {
      if (err instanceof AiProviderError) throw err;
      throw new AiProviderError(FRIENDLY_UNAVAILABLE, err);
    }
  }

  /**
   * One call plus at most one repair round. The grammar guarantees the shape, but Zod
   * refinements (unique section ids, lengths) can still fail; on failure the model gets
   * the Zod issues and its own previous output once.
   */
  async function run<S extends z.ZodTypeAny>(args: {
    system: string;
    user: ContentPart[];
    schema: S;
    timeout: number;
    maxTokens: number;
  }): Promise<{ data: z.output<S>; usage: AiCallUsage }> {
    const messages: Message[] = [{ role: "user", content: args.user }];
    const format = outputFormat(args.schema);
    let inputTokens = 0;
    let outputTokens = 0;

    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await complete({
        system: args.system,
        messages,
        format,
        timeout: args.timeout,
        maxTokens: args.maxTokens,
      });
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
          result.stopReason === "max_tokens"
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
        maxTokens: DRAFT_MAX_TOKENS,
      });
      return { variations: data.variations, usage };
    },

    async rewrite(input) {
      const { data, usage } = await run({
        system: rewriteSystemPrompt(),
        user: [{ type: "text", text: rewriteUserText(input) }],
        schema: RewriteOutput,
        timeout: SMALL_TIMEOUT_MS,
        maxTokens: SMALL_MAX_TOKENS,
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
        maxTokens: SMALL_MAX_TOKENS,
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
        maxTokens: SMALL_MAX_TOKENS,
      });
      return { alt: data.alt, usage };
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
        maxTokens: TRANSLATE_MAX_TOKENS,
      });
      return { overlay: data, usage };
    },

    async edit(input) {
      const { data, usage } = await run({
        system: editSystemPrompt(input),
        user: [{ type: "text", text: editUserText(input) }],
        schema: editOutputSchema(input),
        timeout: input.scope.kind === "page" ? TRANSLATE_TIMEOUT_MS : SMALL_TIMEOUT_MS,
        maxTokens: input.scope.kind === "page" ? PAGE_EDIT_MAX_TOKENS : SMALL_MAX_TOKENS,
      });
      return { options: data.options, usage };
    },

    async addSection(input) {
      const { data, usage } = await run({
        system: addSectionSystemPrompt(input),
        user: [{ type: "text", text: addSectionUserText(input) }],
        schema: AddSectionOutput,
        timeout: SMALL_TIMEOUT_MS,
        maxTokens: SMALL_MAX_TOKENS,
      });
      return { section: data.section, usage };
    },
  };
}
