import { createContext, useContext } from "react";
import type { AiEditScope } from "@ministry/schema";

export type AskAiPrefill = {
  /** Scope to switch to; omitted keeps the current one. */
  scope?: AiEditScope;
  /** Text to put in the bar; omitted keeps what is there. */
  instruction?: string;
};

export interface AskAiContextValue {
  /** True inside an editor that has the Ask AI bar (API mode with AI available). */
  available: boolean;
  /** Fills the Ask AI bar and focuses it. Ghost prompts and suggestions use this. */
  prefill(prefill: AskAiPrefill): void;
}

const AskAiContext = createContext<AskAiContextValue>({ available: false, prefill: () => {} });

export const AskAiProvider = AskAiContext.Provider;

export function useAskAi(): AskAiContextValue {
  return useContext(AskAiContext);
}
