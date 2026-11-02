import type { Bindings } from "../types";
import { createAnthropicProvider, DEFAULT_ANTHROPIC_MODEL } from "./anthropic";
import { createFakeProvider } from "./fake";
import { createOpenAiProvider } from "./openai";
import type { AiProvider } from "./provider";

export type { AiProvider, AiCallUsage } from "./provider";
export { AiProviderError } from "./provider";

const DEFAULT_OPENAI_MODEL = "gpt-5-mini";

/**
 * Fake in tests; otherwise the provider named by AI_PROVIDER ("openai" or
 * "anthropic") when its key is set, else whichever key is set (OpenAI first),
 * else null (routes answer 503).
 */
export function createProvider(env: Bindings): AiProvider | null {
  if (env.AI_PROVIDER === "fake") return createFakeProvider();

  const openai = env.OPENAI_API_KEY
    ? () =>
        createOpenAiProvider({
          apiKey: env.OPENAI_API_KEY!,
          model: env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL,
          images: env.IMAGES,
        })
    : null;
  const anthropic = env.ANTHROPIC_API_KEY
    ? () =>
        createAnthropicProvider({
          apiKey: env.ANTHROPIC_API_KEY!,
          model: env.ANTHROPIC_MODEL || DEFAULT_ANTHROPIC_MODEL,
          images: env.IMAGES,
        })
    : null;

  if (env.AI_PROVIDER === "anthropic") return anthropic?.() ?? null;
  if (env.AI_PROVIDER === "openai") return openai?.() ?? null;
  return openai?.() ?? anthropic?.() ?? null;
}
