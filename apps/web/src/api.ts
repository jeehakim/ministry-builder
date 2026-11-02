import { SiteDocument } from "@ministry/schema";
import { API_URL } from "./env";

export interface SiteSummary {
  id: string;
  slug: string;
  orgName: string;
  updatedAt: string;
}

export interface SiteInfo {
  id: string;
  slug: string;
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

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export type GetToken = () => Promise<string | null>;

const JSON_TIMEOUT_MS = 20_000;
const UPLOAD_TIMEOUT_MS = 60_000;

export interface ApiClient {
  listSites(): Promise<SiteSummary[]>;
  createSite(orgName: string): Promise<LoadedSite>;
  getSite(id: string): Promise<LoadedSite>;
  saveDocument(id: string, document: SiteDocument): Promise<{ versionId: string }>;
  uploadAsset(siteId: string, file: Blob, fileName: string): Promise<UploadedAsset>;
}

export function createApiClient(getToken: GetToken, baseUrl: string = API_URL): ApiClient {
  async function request<T>(path: string, init: RequestInit, timeoutMs: number): Promise<T> {
    const token = await getToken();
    const headers = new Headers(init.headers);
    if (token) headers.set("Authorization", `Bearer ${token}`);

    let res: Response;
    try {
      res = await fetch(`${baseUrl}${path}`, { ...init, headers, signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      const timedOut = err instanceof DOMException && err.name === "TimeoutError";
      throw new ApiError(0, timedOut ? "The server took too long to respond." : "Could not reach the server.");
    }
    if (!res.ok) {
      throw new ApiError(res.status, await errorMessage(res));
    }
    return (await res.json()) as T;
  }

  const json = (method: string, body?: unknown): RequestInit => ({
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  return {
    async listSites() {
      const data = await request<{ sites: SiteSummary[] }>("/sites", json("GET"), JSON_TIMEOUT_MS);
      return data.sites;
    },
    async createSite(orgName) {
      const data = await request<{ site: SiteInfo; document: unknown }>("/sites", json("POST", { orgName }), JSON_TIMEOUT_MS);
      return { site: data.site, document: SiteDocument.parse(data.document) };
    },
    async getSite(id) {
      const data = await request<{ site: SiteInfo; document: unknown }>(
        `/sites/${encodeURIComponent(id)}`,
        json("GET"),
        JSON_TIMEOUT_MS,
      );
      return { site: data.site, document: SiteDocument.parse(data.document) };
    },
    saveDocument(id, document) {
      return request<{ versionId: string }>(
        `/sites/${encodeURIComponent(id)}/document`,
        json("PUT", document),
        JSON_TIMEOUT_MS,
      );
    },
    uploadAsset(siteId, file, fileName) {
      const form = new FormData();
      form.append("file", file, fileName);
      return request<UploadedAsset>(
        `/sites/${encodeURIComponent(siteId)}/assets`,
        { method: "POST", body: form },
        UPLOAD_TIMEOUT_MS,
      );
    },
  };
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const body: unknown = await res.json();
    if (body && typeof body === "object" && "error" in body && typeof body.error === "string") return body.error;
  } catch {
    // fall through to the status text
  }
  if (res.status === 401) return "Your session has expired. Please sign in again.";
  return `Request failed (${res.status}).`;
}
