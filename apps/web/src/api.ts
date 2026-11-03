import {
  AcceptInvitationResponse,
  AiAltTextResponse,
  AiCampaignStoryResponse,
  AiDraftResponse,
  AiRewriteResponse,
  AiThemeResponse,
  AiThankYouResponse,
  AiTranslateResponse,
  AiUsageResponse,
  CampaignListResponse,
  CampaignResponse,
  GiftImportResponse,
  GiftListResponse,
  GiftResponse,
  CreateInvitationResponse,
  EventsResponse,
  IntegrationsResponse,
  InvitationPreview,
  MembersResponse,
  OrgMember,
  OrgRole,
  OrgsResponse,
  SiteDocument,
  type AiCampaignStoryRequest,
  type AiDraftRequest,
  type AiThankYouRequest,
  type CampaignInput,
  type CampaignTotals,
  type CampaignWithTotals,
  type GiftInput,
  type AiRewriteRequest,
  type AiThemeRequest,
  type AiTranslateRequest,
  type CreateInvitationRequest,
  type OrgEvent,
  type OrgSummary,
  type SendTestEmailRequest,
  type SetResendFromRequest,
  type SetResendKeyRequest,
} from "@ministry/schema";
import { API_URL } from "./env";
import { MESSAGES_LIMIT, parseMessagesResponse, type ContactMessage } from "./lib/messages";

export interface SiteSummary {
  id: string;
  /** The organization that owns the site. Null in local mode. */
  orgId: string | null;
  /** The caller's role in that organization. */
  role: OrgRole;
  slug: string;
  orgName: string;
  updatedAt: string;
  /** Live URL on Ministry Sites, or null when the site is not published. */
  publishedUrl: string | null;
  /** When the site was last published, or null. */
  publishedAt: string | null;
}

export interface SiteInfo {
  id: string;
  /** The organization (Clerk org or user) that owns the site; integrations are scoped to it. Null in local mode. */
  orgId: string | null;
  /** The caller's role in the owning organization. Local mode: "owner". */
  role: OrgRole;
  slug: string;
  publishedUrl: string | null;
  publishedAt: string | null;
  /** Contact form messages stored for the site. */
  messageCount: number;
}

/** What `POST /sites` needs. With `orgId` the site joins that organization; without it a new organization is created. */
export interface CreateSiteInput {
  /** Name of the new organization, or of the site when `orgId` is set (the server defaults to the organization's name). */
  orgName?: string;
  orgId?: string;
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

export type DomainKind = "primary" | "redirect";

/** A customer domain attached to a site, as `GET /sites/:id/domains` reports it. */
export interface SiteDomain {
  id: string;
  hostname: string;
  kind: DomainKind;
  /** Cloudflare's certificate status: "pending", "pending_validation", "pending_issuance", "active", ... */
  sslStatus: string;
  /** Set once the ownership TXT record was found. Nothing happens at Cloudflare before that. */
  ownershipVerifiedAt: string | null;
  /** Set once Cloudflare saw the CNAME and marked the hostname active. */
  verifiedAt: string | null;
  /** True once ownership is proved, the hostname is verified and its certificate is live: it serves the site. */
  active: boolean;
  /** The ownership record the customer must create first. */
  txt: { type: string; name: string; value: string };
  /** The routing record the customer must create at their registrar. */
  dns: { type: string; name: string; target: string };
  /** When an unproved domain is removed automatically; null once ownership is proved. */
  expiresAt: string | null;
  createdAt: string;
}

/** Whether a site's contact address has confirmed it wants the contact form's messages. */
export interface ContactEmailStatus {
  email: string;
  verified: boolean;
  verifiedAt: string | null;
  /** When the last verification email went out; null when none was sent or the address is verified. */
  sentAt: string | null;
  /** False when the server has no email provider: messages are stored only, so verification does not apply. */
  enabled: boolean;
}

export interface DomainList {
  domains: SiteDomain[];
  cnameTarget: string;
  /** False when the server has no Cloudflare credentials: adding domains answers 503. */
  enabled: boolean;
}

/** A campaign as the organization-wide list reports it, with the slug of the site it belongs to. */
export type OrgCampaign = CampaignWithTotals & { siteSlug: string };

export interface OrgCampaignList {
  campaigns: OrgCampaign[];
  sites: { id: string; slug: string; published: boolean }[];
}

export class ApiError extends Error {
  readonly status: number;
  /** Present on a 400 from the gifts import: the per-row errors the server found. */
  importResult?: GiftImportResponse;
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
  /** The caller's sites: one organization's with `orgId`, otherwise every organization's. */
  listSites(orgId?: string): Promise<SiteSummary[]>;
  createSite(input: CreateSiteInput): Promise<LoadedSite>;
  getSite(id: string): Promise<LoadedSite>;
  saveDocument(id: string, document: SiteDocument): Promise<{ versionId: string }>;
  uploadAsset(siteId: string, file: Blob, fileName: string): Promise<UploadedAsset>;
  publish(id: string): Promise<PublishResult>;
  unpublish(id: string): Promise<void>;
  listDomains(siteId: string): Promise<DomainList>;
  addDomain(siteId: string, hostname: string, kind: DomainKind): Promise<SiteDomain>;
  refreshDomain(siteId: string, domainId: string): Promise<SiteDomain>;
  removeDomain(siteId: string, domainId: string): Promise<void>;
  contactEmailStatus(siteId: string, email: string): Promise<ContactEmailStatus>;
  /** Emails a verification link to `email`; the status comes back unverified until the link is opened. */
  requestContactEmailVerification(siteId: string, email: string): Promise<ContactEmailStatus>;
  /** Deletes the site and everything it owns. */
  deleteSite(id: string): Promise<void>;
  listMessages(siteId: string): Promise<ContactMessage[]>;
  deleteMessage(siteId: string, id: string): Promise<void>;
  getIntegrations(orgId: string): Promise<IntegrationsResponse>;
  setResendKey(orgId: string, body: SetResendKeyRequest): Promise<IntegrationsResponse>;
  setResendFrom(orgId: string, body: SetResendFromRequest): Promise<IntegrationsResponse>;
  sendResendTest(orgId: string, body: SendTestEmailRequest): Promise<IntegrationsResponse>;
  disconnectResend(orgId: string): Promise<void>;
  /** `orgId` adds the organization's own count to the response. */
  aiUsage(orgId?: string): Promise<AiUsageResponse>;
  aiDraft(siteId: string, body: AiDraftRequest): Promise<AiDraftResponse>;
  aiRewrite(siteId: string, body: AiRewriteRequest): Promise<AiRewriteResponse>;
  aiTheme(siteId: string, body: AiThemeRequest): Promise<AiThemeResponse>;
  aiAltText(siteId: string, assetKey: string): Promise<AiAltTextResponse>;
  aiTranslate(siteId: string, language: string): Promise<AiTranslateResponse>;
  aiCampaignStory(siteId: string, campaignId: string, body: AiCampaignStoryRequest): Promise<AiCampaignStoryResponse>;
  aiThankYou(siteId: string, campaignId: string, body: AiThankYouRequest): Promise<AiThankYouResponse>;
  listOrgCampaigns(orgId: string): Promise<OrgCampaignList>;
  listCampaigns(siteId: string): Promise<CampaignWithTotals[]>;
  getCampaign(siteId: string, campaignId: string): Promise<CampaignWithTotals>;
  createCampaign(siteId: string, body: CampaignInput): Promise<CampaignWithTotals>;
  updateCampaign(siteId: string, campaignId: string, body: CampaignInput): Promise<CampaignWithTotals>;
  deleteCampaign(siteId: string, campaignId: string): Promise<void>;
  listGifts(siteId: string, campaignId: string): Promise<GiftListResponse>;
  addGift(siteId: string, campaignId: string, body: GiftInput): Promise<GiftResponse>;
  deleteGift(siteId: string, campaignId: string, giftId: string): Promise<CampaignTotals>;
  /** Resolves with the import result; a 400 with row errors is returned, not thrown. */
  importGifts(siteId: string, campaignId: string, csv: string): Promise<GiftImportResponse>;
  listOrgs(): Promise<OrgSummary[]>;
  orgMembers(orgId: string): Promise<MembersResponse>;
  updateMember(orgId: string, userId: string, role: OrgRole): Promise<OrgMember>;
  removeMember(orgId: string, userId: string): Promise<void>;
  invite(orgId: string, body: CreateInvitationRequest): Promise<CreateInvitationResponse>;
  revokeInvitation(orgId: string, invitationId: string): Promise<void>;
  /** Public: sends no credentials, so it works before sign-in. */
  previewInvitation(token: string): Promise<InvitationPreview>;
  acceptInvitation(token: string): Promise<AcceptInvitationResponse>;
  transferOwnership(orgId: string, userId: string): Promise<void>;
  /** Newest first. */
  orgEvents(orgId: string): Promise<OrgEvent[]>;
}

type ErrorFactory = (status: number, message: string, body: unknown) => ApiError;

const plainError: ErrorFactory = (status, message, body) => {
  const error = new ApiError(status, message);
  const parsed = status === 400 ? GiftImportResponse.safeParse(body) : null;
  if (parsed?.success) error.importResult = parsed.data;
  return error;
};

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
  orgId?: string | null;
  role?: unknown;
  slug: string;
  publishedUrl?: string | null;
  publishedAt?: string | null;
  messageCount?: number;
}

/** Servers from before organizations send no role; those callers owned their sites, so "owner" keeps them working. */
function roleOrOwner(raw: unknown): OrgRole {
  const parsed = OrgRole.safeParse(raw);
  return parsed.success ? parsed.data : "owner";
}

function toSiteInfo(raw: RawSiteInfo): SiteInfo {
  return {
    id: raw.id,
    orgId: raw.orgId ?? null,
    role: roleOrOwner(raw.role),
    slug: raw.slug,
    publishedUrl: raw.publishedUrl ?? null,
    publishedAt: raw.publishedAt ?? null,
    messageCount: raw.messageCount ?? 0,
  };
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
  if (body && typeof body === "object" && "errors" in body && Array.isArray(body.errors) && body.errors.length) return "Some rows could not be imported.";
  if (status === 401) return "Your session has expired. Please sign in again.";
  return `Request failed (${status}).`;
}

export function createApiClient(getToken: GetToken, baseUrl: string = API_URL): ApiClient {
  async function request<T>(
    path: string,
    init: RequestInit,
    timeoutMs: number,
    makeError: ErrorFactory = plainError,
    authenticated = true,
  ): Promise<T> {
    const headers = new Headers(init.headers);
    if (authenticated) {
      const token = await getToken();
      if (token) headers.set("Authorization", `Bearer ${token}`);
    }

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
  const resendPath = (orgId: string) => `/orgs/${encodeURIComponent(orgId)}/integrations/resend`;

  /** Request plus response validation; secrets never come back, and a drifting shape is a 502, not a crash. */
  async function integrationsRequest(path: string, init: RequestInit): Promise<IntegrationsResponse> {
    const data = await request<unknown>(path, init, JSON_TIMEOUT_MS);
    const parsed = IntegrationsResponse.safeParse(data);
    if (!parsed.success) throw new ApiError(502, "The server sent an unexpected response.");
    return parsed.data;
  }

  const orgPath = (orgId: string) => `/orgs/${encodeURIComponent(orgId)}`;

  /** Request plus response validation with a shared schema; a drifting shape is a 502, not a crash. */
  async function validated<T>(path: string, parser: Parser<T>, init: RequestInit, authenticated = true): Promise<T> {
    const data = await request<unknown>(path, init, JSON_TIMEOUT_MS, plainError, authenticated);
    const parsed = parser.safeParse(data);
    if (!parsed.success) throw new ApiError(502, "The server sent an unexpected response.");
    return parsed.data;
  }

  const campaignPath = (siteId: string, campaignId: string) => `${sitePath(siteId)}/campaigns/${encodeURIComponent(campaignId)}`;

  return {
    async listSites(orgId) {
      const query = orgId ? `?orgId=${encodeURIComponent(orgId)}` : "";
      const data = await request<{
        sites: (Omit<SiteSummary, "publishedUrl" | "publishedAt" | "orgId" | "role"> & { orgId?: string | null; role?: unknown; publishedUrl?: string | null; publishedAt?: string | null })[];
      }>(`/sites${query}`, json("GET"), JSON_TIMEOUT_MS);
      return data.sites.map((s) => ({ ...s, orgId: s.orgId ?? null, role: roleOrOwner(s.role), publishedUrl: s.publishedUrl ?? null, publishedAt: s.publishedAt ?? null }));
    },
    async createSite(input) {
      const data = await request<{ site: RawSiteInfo; document: unknown }>("/sites", json("POST", input), JSON_TIMEOUT_MS);
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
    listDomains(siteId) {
      return request<DomainList>(`${sitePath(siteId)}/domains`, json("GET"), JSON_TIMEOUT_MS);
    },
    async addDomain(siteId, hostname, kind) {
      return (await request<{ domain: SiteDomain }>(`${sitePath(siteId)}/domains`, json("POST", { hostname, kind }), JSON_TIMEOUT_MS)).domain;
    },
    async refreshDomain(siteId, domainId) {
      const path = `${sitePath(siteId)}/domains/${encodeURIComponent(domainId)}/refresh`;
      return (await request<{ domain: SiteDomain }>(path, json("POST"), JSON_TIMEOUT_MS)).domain;
    },
    async removeDomain(siteId, domainId) {
      await request<unknown>(`${sitePath(siteId)}/domains/${encodeURIComponent(domainId)}`, json("DELETE"), JSON_TIMEOUT_MS);
    },
    contactEmailStatus(siteId, email) {
      return request<ContactEmailStatus>(`${sitePath(siteId)}/contact-email?email=${encodeURIComponent(email)}`, json("GET"), JSON_TIMEOUT_MS);
    },
    requestContactEmailVerification(siteId, email) {
      return request<ContactEmailStatus>(`${sitePath(siteId)}/contact-email/verify`, json("POST", { email }), JSON_TIMEOUT_MS);
    },
    async deleteSite(id) {
      await request<unknown>(sitePath(id), json("DELETE"), JSON_TIMEOUT_MS);
    },
    async listMessages(siteId) {
      const data = await request<unknown>(`${sitePath(siteId)}/messages?limit=${MESSAGES_LIMIT}`, json("GET"), JSON_TIMEOUT_MS);
      const messages = parseMessagesResponse(data);
      if (!messages) throw new ApiError(502, "The server sent an unexpected messages response.");
      return messages;
    },
    async deleteMessage(siteId, id) {
      await request<unknown>(`${sitePath(siteId)}/messages/${encodeURIComponent(id)}`, json("DELETE"), JSON_TIMEOUT_MS);
    },
    getIntegrations(orgId) {
      return integrationsRequest(`/orgs/${encodeURIComponent(orgId)}/integrations`, json("GET"));
    },
    setResendKey(orgId, body) {
      return integrationsRequest(`${resendPath(orgId)}/key`, json("PUT", body));
    },
    setResendFrom(orgId, body) {
      return integrationsRequest(`${resendPath(orgId)}/from`, json("PUT", body));
    },
    sendResendTest(orgId, body) {
      return integrationsRequest(`${resendPath(orgId)}/test`, json("POST", body));
    },
    async disconnectResend(orgId) {
      await request<unknown>(resendPath(orgId), json("DELETE"), JSON_TIMEOUT_MS);
    },
    aiUsage(orgId) {
      const query = orgId ? `?orgId=${encodeURIComponent(orgId)}` : "";
      return aiRequest(`/ai/usage${query}`, AiUsageResponse, json("GET"), JSON_TIMEOUT_MS);
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
    aiCampaignStory(siteId, campaignId, body) {
      return aiRequest(`${campaignPath(siteId, campaignId)}/ai/story`, AiCampaignStoryResponse, json("POST", body), AI_TIMEOUT_MS);
    },
    aiThankYou(siteId, campaignId, body) {
      return aiRequest(`${campaignPath(siteId, campaignId)}/ai/thank-you`, AiThankYouResponse, json("POST", body), AI_TIMEOUT_MS);
    },
    listOrgCampaigns(orgId) {
      return request<OrgCampaignList>(`/orgs/${encodeURIComponent(orgId)}/campaigns`, json("GET"), JSON_TIMEOUT_MS);
    },
    async listCampaigns(siteId) {
      return (await validated(`${sitePath(siteId)}/campaigns`, CampaignListResponse, json("GET"))).campaigns;
    },
    async getCampaign(siteId, campaignId) {
      return (await validated(campaignPath(siteId, campaignId), CampaignResponse, json("GET"))).campaign;
    },
    async createCampaign(siteId, body) {
      return (await validated(`${sitePath(siteId)}/campaigns`, CampaignResponse, json("POST", body))).campaign;
    },
    async updateCampaign(siteId, campaignId, body) {
      return (await validated(campaignPath(siteId, campaignId), CampaignResponse, json("PUT", body))).campaign;
    },
    async deleteCampaign(siteId, campaignId) {
      await request<unknown>(campaignPath(siteId, campaignId), json("DELETE"), JSON_TIMEOUT_MS);
    },
    listGifts(siteId, campaignId) {
      return validated(`${campaignPath(siteId, campaignId)}/gifts?limit=2000`, GiftListResponse, json("GET"));
    },
    addGift(siteId, campaignId, body) {
      return validated(`${campaignPath(siteId, campaignId)}/gifts`, GiftResponse, json("POST", body));
    },
    async deleteGift(siteId, campaignId, giftId) {
      const data = await request<{ totals: CampaignTotals }>(`${campaignPath(siteId, campaignId)}/gifts/${encodeURIComponent(giftId)}`, json("DELETE"), JSON_TIMEOUT_MS);
      return data.totals;
    },
    async importGifts(siteId, campaignId, csv) {
      try {
        return await validated(`${campaignPath(siteId, campaignId)}/gifts/import`, GiftImportResponse, json("POST", { csv }));
      } catch (err) {
        // Row errors come back as a 400 whose body is the same envelope; surface them instead of a bare message.
        if (err instanceof ApiError && err.status === 400 && err.importResult) return err.importResult;
        throw err;
      }
    },
    async listOrgs() {
      return (await validated("/orgs", OrgsResponse, json("GET"))).orgs;
    },
    orgMembers(orgId) {
      return validated(`${orgPath(orgId)}/members`, MembersResponse, json("GET"));
    },
    async updateMember(orgId, userId, role) {
      const data = await request<unknown>(`${orgPath(orgId)}/members/${encodeURIComponent(userId)}`, json("PATCH", { role }), JSON_TIMEOUT_MS);
      const parsed = OrgMember.safeParse(data && typeof data === "object" && "member" in data ? data.member : undefined);
      if (!parsed.success) throw new ApiError(502, "The server sent an unexpected response.");
      return parsed.data;
    },
    async removeMember(orgId, userId) {
      await request<unknown>(`${orgPath(orgId)}/members/${encodeURIComponent(userId)}`, json("DELETE"), JSON_TIMEOUT_MS);
    },
    invite(orgId, body) {
      return validated(`${orgPath(orgId)}/invitations`, CreateInvitationResponse, json("POST", body));
    },
    async revokeInvitation(orgId, invitationId) {
      await request<unknown>(`${orgPath(orgId)}/invitations/${encodeURIComponent(invitationId)}`, json("DELETE"), JSON_TIMEOUT_MS);
    },
    previewInvitation(token) {
      return validated(`/invitations/${encodeURIComponent(token)}`, InvitationPreview, json("GET"), false);
    },
    acceptInvitation(token) {
      return validated(`/invitations/${encodeURIComponent(token)}/accept`, AcceptInvitationResponse, json("POST"));
    },
    async transferOwnership(orgId, userId) {
      await request<unknown>(`${orgPath(orgId)}/transfer-ownership`, json("POST", { userId }), JSON_TIMEOUT_MS);
    },
    async orgEvents(orgId) {
      return (await validated(`${orgPath(orgId)}/events?limit=100`, EventsResponse, json("GET"))).events;
    },
  };
}
