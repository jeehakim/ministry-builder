import {
  AiAltTextResponse,
  AiDraftResponse,
  AiRewriteResponse,
  AiThemeResponse,
  AiTranslateResponse,
  AiUsageResponse,
  SiteDocument,
  type AiDraftRequest,
  type AiRewriteRequest,
  type AiThemeRequest,
  type AiTranslateRequest,
} from "@ministry/schema";
import { API_URL } from "./env";

export interface SiteSummary {
  id: string;
  slug: string;
  orgName: string;
  updatedAt: string;
  /** Live URL on Ministry Sites, or null when the site is not published. */
  publishedUrl: string | null;
}

export interface SiteInfo {
  id: string;
  slug: string;
  publishedUrl: string | null;
  publishedAt: string | null;
}

export interface LoadedSite {
  site: SiteInfo;
  document: SiteDocument;
}

export interface UploadedAsset {
  id: string;
  key: string;
  /** Path on the API, e.g. "/assets/...". Prefix with the API origin for an absolute URL. */
  url: string;
}

export interface PublishResult {
  url: string;
  publishedAt: string;
}

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** A failed AI call. `used`, `limit` and `resetsAt` are present on a 429 (daily quota hit). */
export class AiError extends ApiError {
  readonly used?: number;
  readonly limit?: number;
  readonly resetsAt?: string;
  constructor(status: number, message: string, quota: { used?: number; limit?: number; resetsAt?: string } = {}) {
    super(status, message);
    this.name = "AiError";
    this.used = quota.used;
    this.limit = quota.limit;
    this.resetsAt = quota.resetsAt;
  }
}

export type GetToken = () => Promise<string | null>;

const JSON_TIMEOUT_MS = 20_000;
const UPLOAD_TIMEOUT_MS = 60_000;
const AI_TIMEOUT_MS = 45_000;
/** Drafting writes up to three full pages and can take 30 to 90 seconds. */
const AI_DRAFT_TIMEOUT_MS = 120_000;
/** Translating a whole page is a single large generation. */
const AI_TRANSLATE_TIMEOUT_MS = 90_000;

export interface ApiClient {
  listSites(): Promise<SiteSummary[]>;
  createSite(orgName: string): Promise<LoadedSite>;
  getSite(id: string): Promise<LoadedSite>;
  saveDocument(id: string, document: SiteDocument): Promise<{ versionId: string }>;
  uploadAsset(siteId: string, file: Blob, fileName: string): Promise<UploadedAsset>;
  publish(id: string): Promise<PublishResult>;
  unpublish(id: string): Promise<void>;
  aiUsage(): Promise<AiUsageResponse>;
  aiDraft(siteId: string, body: AiDraftRequest): Promise<AiDraftResponse>;
  aiRewrite(siteId: string, body: AiRewriteRequest): Promise<AiRewriteResponse>;
  aiTheme(siteId: string, body: AiThemeRequest): Promise<AiThemeResponse>;
  aiAltText(siteId: string, assetKey: string): Promise<AiAltTextResponse>;
  aiTranslate(siteId: string, language: string): Promise<AiTranslateResponse>;
}

type ErrorFactory = (status: number, message: string, body: unknown) => ApiError;

const plainError: ErrorFactory = (status, message) => new ApiError(status, message);

const aiError: ErrorFactory = (status, message, body) => {
  const fields = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  return new AiError(status, message, {
    used: typeof fields.used === "number" ? fields.used : undefined,
    limit: typeof fields.limit === "number" ? fields.limit : undefined,
    resetsAt: typeof fields.resetsAt === "string" ? fields.resetsAt : undefined,
  });
};

/** Structural stand-in for a Zod schema, so this file needs no direct zod import. */
interface Parser<T> {
  safeParse(data: unknown): { success: true; data: T } | { success: false };
}

/** The site envelope as the server may send it: publish fields can be absent on older deployments. */
interface RawSiteInfo {
  id: string;
  slug: string;
  publishedUrl?: string | null;
  publishedAt?: string | null;
}

function toSiteInfo(raw: RawSiteInfo): SiteInfo {
  return { id: raw.id, slug: raw.slug, publishedUrl: raw.publishedUrl ?? null, publishedAt: raw.publishedAt ?? null };
}

function isPublishResult(v: unknown): v is PublishResult {
  return (
    typeof v === "object" &&
    v !== null &&
    "url" in v &&
    typeof v.url === "string" &&
    "publishedAt" in v &&
    typeof v.publishedAt === "string"
  );
}

function errorMessage(status: number, body: unknown): string {
  if (body && typeof body === "object" && "error" in body && typeof body.error === "string") return body.error;
  if (status === 401) return "Your session has expired. Please sign in again.";
  return `Request failed (${status}).`;
}

export function createApiClient(getToken: GetToken, baseUrl: string = API_URL): ApiClient {
  async function request<T>(
    path: string,
    init: RequestInit,
    timeoutMs: number,
    makeError: ErrorFactory = plainError,
  ): Promise<T> {
    const token = await getToken();
    const headers = new Headers(init.headers);
    if (token) headers.set("Authorization", `Bearer ${token}`);

    let res: Response;
    try {
      res = await fetch(`${baseUrl}${path}`, { ...init, headers, signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      const timedOut = err instanceof DOMException && err.name === "TimeoutError";
      throw makeError(0, timedOut ? "The server took too long to respond." : "Could not reach the server.", undefined);
    }

    // Read as text first: an empty 200 (unpublish) is valid, and an error body may not be JSON.
    const text = await res.text().catch(() => "");
    let body: unknown;
    let malformed = false;
    if (text !== "") {
      try {
        body = JSON.parse(text);
      } catch {
        malformed = true;
      }
    }
    if (!res.ok) throw makeError(res.status, errorMessage(res.status, body), body);
    if (malformed) throw makeError(res.status, "The server sent an unexpected response.", undefined);
    return body as T;
  }

  /** Request plus response validation with the shared schema; the server's shape drifting is a 502, not a crash. */
  async function aiRequest<T>(path: string, parser: Parser<T>, init: RequestInit, timeoutMs: number): Promise<T> {
    const data = await request<unknown>(path, init, timeoutMs, aiError);
    const parsed = parser.safeParse(data);
    if (!parsed.success) throw new AiError(502, "The AI response was not in the expected format.");
    return parsed.data;
  }

  const json = (method: string, body?: unknown): RequestInit => ({
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const sitePath = (id: string) => `/sites/${encodeURIComponent(id)}`;

  return {
    async listSites() {
      const data = await request<{ sites: (Omit<SiteSummary, "publishedUrl"> & { publishedUrl?: string | null })[] }>(
        "/sites",
        json("GET"),
        JSON_TIMEOUT_MS,
      );
      return data.sites.map((s) => ({ ...s, publishedUrl: s.publishedUrl ?? null }));
    },
    async createSite(orgName) {
      const data = await request<{ site: RawSiteInfo; document: unknown }>("/sites", json("POST", { orgName }), JSON_TIMEOUT_MS);
      return { site: toSiteInfo(data.site), document: SiteDocument.parse(data.document) };
    },
    async getSite(id) {
      const data = await request<{ site: RawSiteInfo; document: unknown }>(sitePath(id), json("GET"), JSON_TIMEOUT_MS);
      return { site: toSiteInfo(data.site), document: SiteDocument.parse(data.document) };
    },
    saveDocument(id, document) {
      return request<{ versionId: string }>(`${sitePath(id)}/document`, json("PUT", document), JSON_TIMEOUT_MS);
    },
    uploadAsset(siteId, file, fileName) {
      const form = new FormData();
      form.append("file", file, fileName);
      return request<UploadedAsset>(`${sitePath(siteId)}/assets`, { method: "POST", body: form }, UPLOAD_TIMEOUT_MS);
    },
    async publish(id) {
      const data = await request<unknown>(`${sitePath(id)}/publish`, json("POST"), JSON_TIMEOUT_MS);
      if (!isPublishResult(data)) throw new ApiError(502, "The server sent an unexpected publish response.");
      return data;
    },
    async unpublish(id) {
      await request<unknown>(`${sitePath(id)}/unpublish`, json("POST"), JSON_TIMEOUT_MS);
    },
    aiUsage() {
      return aiRequest("/ai/usage", AiUsageResponse, json("GET"), JSON_TIMEOUT_MS);
    },
    aiDraft(siteId, body) {
      return aiRequest(`${sitePath(siteId)}/ai/draft`, AiDraftResponse, json("POST", body), AI_DRAFT_TIMEOUT_MS);
    },
    aiRewrite(siteId, body) {
      return aiRequest(`${sitePath(siteId)}/ai/rewrite`, AiRewriteResponse, json("POST", body), AI_TIMEOUT_MS);
    },
    aiTheme(siteId, body) {
      return aiRequest(`${sitePath(siteId)}/ai/theme`, AiThemeResponse, json("POST", body), AI_TIMEOUT_MS);
    },
    aiAltText(siteId, assetKey) {
      return aiRequest(`${sitePath(siteId)}/ai/alt-text`, AiAltTextResponse, json("POST", { assetKey }), AI_TIMEOUT_MS);
    },
    aiTranslate(siteId, language) {
      const body: AiTranslateRequest = { language };
      return aiRequest(`${sitePath(siteId)}/ai/translate`, AiTranslateResponse, json("POST", body), AI_TRANSLATE_TIMEOUT_MS);
    },
  };
}
