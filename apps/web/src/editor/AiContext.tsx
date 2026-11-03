import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type {
  AiCampaignStoryRequest,
  AiCampaignStoryResponse,
  AiDraftRequest,
  AiDraftResponse,
  AiRewriteRequest,
  AiThankYouRequest,
  AiThemeRequest,
  AiThemeResponse,
  AiTranslateResponse,
  AiUsageResponse,
} from "@ministry/schema";
import { toast } from "sonner";
import { AiError } from "../api";
import type { AiBackend } from "../backend";
import { useBackend } from "../backend-context";
import { aiFailureText } from "../lib/aiMessages";
import { useBeforeUnloadGuard } from "../lib/useBeforeUnloadGuard";
import { assetKeyFromSrc } from "../lib/urls";
import { useSiteId } from "./EditorContext";

export type UsageState =
  | { kind: "none" }
  | { kind: "loading" }
  | { kind: "ready"; usage: AiUsageResponse }
  | { kind: "error"; message: string };

export const LOCAL_AI_REASON = "AI needs an account. Local mode keeps your site in this browser only, so it is off here.";
export const NO_KEY_REASON = "No AI key configured on the server";
export const VIEW_ONLY_REASON = "AI is off because you can only view this site.";

export const DRAFT_BUSY_KEY = "draft";
export const THEME_BUSY_KEY = "theme";
export const TRANSLATE_BUSY_KEY = "translate";

export interface AiContextValue {
  /** The AI client, or null in local mode. */
  ai: AiBackend | null;
  usage: UsageState;
  /** True when an AI call can be attempted. */
  enabled: boolean;
  /** Why AI is unavailable, for tooltips; null when enabled. */
  disabledReason: string | null;
  /** In-flight calls by caller key (for example "draft", "theme", "rewrite:<field>"). */
  busy: Readonly<Record<string, boolean>>;
  refreshUsage(): Promise<void>;
  /** Each run* resolves to the result, or null after showing the error as a toast. */
  runDraft(request: AiDraftRequest): Promise<AiDraftResponse | null>;
  runRewrite(key: string, request: AiRewriteRequest): Promise<string | null>;
  runAltText(key: string, imageSrc: string): Promise<string | null>;
  runTheme(request: AiThemeRequest): Promise<AiThemeResponse | null>;
  runTranslate(language: string): Promise<AiTranslateResponse | null>;
  runCampaignStory(campaignId: string, request: AiCampaignStoryRequest): Promise<AiCampaignStoryResponse | null>;
  runThankYou(campaignId: string, request: AiThankYouRequest): Promise<string | null>;
}

export const CAMPAIGN_STORY_BUSY_KEY = "campaign-story";
export const THANK_YOU_BUSY_KEY = "thank-you";

const noop = async () => {};
const unavailable = async () => null;

/** What components see outside an editor, and in local mode: no AI, nothing busy. */
const INERT: AiContextValue = {
  ai: null,
  usage: { kind: "none" },
  enabled: false,
  disabledReason: LOCAL_AI_REASON,
  busy: {},
  refreshUsage: noop,
  runDraft: unavailable,
  runRewrite: unavailable,
  runAltText: unavailable,
  runTheme: unavailable,
  runTranslate: unavailable,
  runCampaignStory: unavailable,
  runThankYou: unavailable,
};

const AiContext = createContext<AiContextValue>(INERT);

export function useAi(): AiContextValue {
  return useContext(AiContext);
}

function failureText(err: unknown): string {
  if (err instanceof AiError) return aiFailureText({ status: err.status, message: err.message, resetsAt: err.resetsAt });
  return err instanceof Error ? err.message : "Something went wrong with the AI request.";
}

export function AiProvider({ orgId = null, readOnly = false, children }: { orgId?: string | null; readOnly?: boolean; children: ReactNode }) {
  const backend = useBackend();
  const siteId = useSiteId();
  // A viewer gets no AI client at all, so every AI button hides itself and nothing is fetched or counted.
  const ai = readOnly ? null : (backend.ai ?? null);

  const [usage, setUsage] = useState<UsageState>(ai ? { kind: "loading" } : { kind: "none" });
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  // Only the newest usage response may win, so a slow earlier fetch cannot overwrite fresh numbers.
  const usageSeq = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // A draft or translation that is reloaded away is lost (and still counts against the daily quota).
  useBeforeUnloadGuard(busy[DRAFT_BUSY_KEY] === true || busy[TRANSLATE_BUSY_KEY] === true);

  const refreshUsage = useCallback(async () => {
    if (!ai) return;
    const seq = ++usageSeq.current;
    try {
      const next = await ai.usage(orgId ?? undefined);
      if (mounted.current && seq === usageSeq.current) setUsage({ kind: "ready", usage: next });
    } catch (err) {
      if (mounted.current && seq === usageSeq.current) {
        setUsage((current) =>
          current.kind === "ready" ? current : { kind: "error", message: err instanceof Error ? err.message : "Could not load AI usage." },
        );
      }
    }
  }, [ai, orgId]);

  useEffect(() => {
    void refreshUsage();
  }, [refreshUsage]);

  const run = useCallback(
    async <T,>(key: string, call: (client: AiBackend) => Promise<T>): Promise<T | null> => {
      if (!ai) return null;
      setBusy((current) => ({ ...current, [key]: true }));
      try {
        return await call(ai);
      } catch (err) {
        toast.error(failureText(err));
        return null;
      } finally {
        if (mounted.current) setBusy((current) => ({ ...current, [key]: false }));
        void refreshUsage();
      }
    },
    [ai, refreshUsage],
  );

  const value = useMemo<AiContextValue>(() => {
    const unavailableByServer = usage.kind === "ready" && !usage.usage.available;
    const enabled = ai !== null && !unavailableByServer;
    return {
      ai,
      usage,
      enabled,
      disabledReason: enabled ? null : readOnly ? VIEW_ONLY_REASON : ai === null ? LOCAL_AI_REASON : NO_KEY_REASON,
      busy,
      refreshUsage,
      runDraft: (request) => run(DRAFT_BUSY_KEY, (client) => client.draft(siteId, request)),
      runRewrite: async (key, request) => {
        const result = await run(key, (client) => client.rewrite(siteId, request));
        return result ? result.text : null;
      },
      runAltText: async (key, imageSrc) => {
        const assetKey = assetKeyFromSrc(imageSrc);
        if (!assetKey) {
          toast.error("Alt text needs an uploaded image. Replace this image and try again.");
          return null;
        }
        const result = await run(key, (client) => client.altText(siteId, assetKey));
        return result ? result.alt : null;
      },
      runTheme: (request) => run(THEME_BUSY_KEY, (client) => client.theme(siteId, request)),
      runTranslate: (language) => run(TRANSLATE_BUSY_KEY, (client) => client.translate(siteId, language)),
      runCampaignStory: (campaignId, request) => run(CAMPAIGN_STORY_BUSY_KEY, (client) => client.campaignStory(siteId, campaignId, request)),
      runThankYou: async (campaignId, request) => {
        const result = await run(THANK_YOU_BUSY_KEY, (client) => client.thankYou(siteId, campaignId, request));
        return result ? result.message : null;
      },
    };
  }, [ai, readOnly, usage, busy, refreshUsage, run, siteId]);

  return <AiContext.Provider value={value}>{children}</AiContext.Provider>;
}
