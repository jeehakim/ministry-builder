import type { Bindings } from "../types";
import { createFakeProvider } from "./fake";
import { createOpenAiProvider } from "./openai";
import type { AiProvider } from "./provider";

export type { AiProvider, AiCallUsage } from "./provider";
export { AiProviderError } from "./provider";

const DEFAULT_MODEL = "gpt-5-mini";

/** Fake in tests, OpenAI when a key is configured, otherwise null (routes answer 503). */
export function createProvider(env: Bindings): AiProvider | null {
  if (env.AI_PROVIDER === "fake") return createFakeProvider();
  if (env.OPENAI_API_KEY) {
    return createOpenAiProvider({
      apiKey: env.OPENAI_API_KEY,
      model: env.OPENAI_MODEL || DEFAULT_MODEL,
      images: env.IMAGES,
    });
  }
  return null;
}
