import {
  emptySiteDocument,
  SiteDocument,
  type AiAddSectionRequest,
  type AiAddSectionResponse,
  type AiAltTextResponse,
  type AiDraftRequest,
  type AiDraftResponse,
  type AiEditRequest,
  type AiEditResponse,
  type AiRewriteRequest,
  type AiRewriteResponse,
  type AiThemeRequest,
  type AiThemeResponse,
  type AiTranslateResponse,
  type AiUsageResponse,
  type ImageRef,
  type IntegrationsResponse,
  type SendTestEmailRequest,
  type SetResendFromRequest,
  type SetResendKeyRequest,
} from "@ministry/schema";
import {
  createApiClient,
  ApiError,
  type ContactEmailStatus,
  type DomainKind,
  type DomainList,
  type GetToken,
  type LoadedSite,
  type PublishResult,
  type SiteDomain,
  type SiteSummary,
} from "./api";
import { API_URL } from "./env";
import { slugify } from "./lib/files";
import type { ContactMessage } from "./lib/messages";

/** AI copilot calls. Only the API backend has them. */
export interface AiBackend {
  usage(): Promise<AiUsageResponse>;
  draft(siteId: string, request: AiDraftRequest): Promise<AiDraftResponse>;
  rewrite(siteId: string, request: AiRewriteRequest): Promise<AiRewriteResponse>;
  theme(siteId: string, request: AiThemeRequest): Promise<AiThemeResponse>;
  /** `assetKey` is the R2 key: an `ImageRef.src` without its "/assets/" prefix. */
  altText(siteId: string, assetKey: string): Promise<AiAltTextResponse>;
  /** Translates the whole page into `language`. The server also saves the overlay as a new version. */
  translate(siteId: string, language: string): Promise<AiTranslateResponse>;
  /** Proposes changes to one scope of the saved page. Nothing is stored until the editor applies them. */
  edit(siteId: string, request: AiEditRequest): Promise<AiEditResponse>;
  /** Writes one new section for the saved page; the editor inserts it. */
  addSection(siteId: string, request: AiAddSectionRequest): Promise<AiAddSectionResponse>;
}

/** Customer domains on hosted sites. Only the API backend has them. */
export interface DomainsBackend {
  list(siteId: string): Promise<DomainList>;
  add(siteId: string, hostname: string, kind: DomainKind): Promise<SiteDomain>;
  /** Asks the server to re-check verification and certificate status with Cloudflare. */
  refresh(siteId: string, domainId: string): Promise<SiteDomain>;
  remove(siteId: string, domainId: string): Promise<void>;
}

/** Double opt-in for the address the contact form delivers to. Only the API backend has it. */
export interface ContactEmailBackend {
  status(siteId: string, email: string): Promise<ContactEmailStatus>;
  /** Sends (or re-sends) the verification email. */
  verify(siteId: string, email: string): Promise<ContactEmailStatus>;
}

/** The contact form inbox. Only the API backend has it. */
export interface MessagesBackend {
  list(siteId: string): Promise<ContactMessage[]>;
  remove(siteId: string, id: string): Promise<void>;
}

/** Bring-your-own integrations (Resend), scoped to the site's organization. Only the API backend has them. */
export interface IntegrationsBackend {
  get(orgId: string): Promise<IntegrationsResponse>;
  /** Stores the key (encrypted server-side) and returns the view with its hint and verified domains. */
  setResendKey(orgId: string, request: SetResendKeyRequest): Promise<IntegrationsResponse>;
  setResendFrom(orgId: string, request: SetResendFromRequest): Promise<IntegrationsResponse>;
  sendResendTest(orgId: string, request: SendTestEmailRequest): Promise<IntegrationsResponse>;
  /** Removes the stored key; delivery returns to the platform default. */
  disconnectResend(orgId: string): Promise<void>;
}

/**
 * What the editor needs from storage. The hosted implementation talks to the
 * API; the local one uses localStorage. Editor code only sees this interface.
 */
export interface Backend {
  mode: "api" | "local";
  listSites(): Promise<SiteSummary[]>;
  createSite(orgName: string): Promise<LoadedSite>;
  loadSite(id: string): Promise<LoadedSite>;
  saveDocument(id: string, document: SiteDocument): Promise<void>;
  /** Stores an image and returns the value to put in `ImageRef.src`. */
  uploadImage(siteId: string, file: Blob, fileName: string): Promise<string>;
  /** Maps an image reference to a URL usable in rendered HTML (preview). */
  imageUrl(ref: ImageRef): string;
  /** Present in API mode only; local mode has no AI, so the UI hides it and says why. */
  ai?: AiBackend;
  /** Present in API mode only; local mode has no hosted form, so no inbox. */
  messages?: MessagesBackend;
  /** Present in API mode only: verification of the contact address the hosted form emails. */
  contactEmail?: ContactEmailBackend;
  /** Present in API mode only; local mode has no hosted form, so nothing to deliver. */
  integrations?: IntegrationsBackend;
  /** Publishes the saved document on Ministry Sites. API mode only. */
  publish?(siteId: string): Promise<PublishResult>;
  unpublish?(siteId: string): Promise<void>;
  /** Custom domains for the published site. API mode only. */
  domains?: DomainsBackend;
  /** Deletes a site with everything it owns (versions, images, published files, messages). API mode only. */
  deleteSite?(siteId: string): Promise<void>;
}

const ABSOLUTE = /^(https?:|data:|blob:)/i;

export function createApiBackend(getToken: GetToken): Backend {
  const api = createApiClient(getToken);
  return {
    mode: "api",
    listSites: () => api.listSites(),
    createSite: (orgName) => api.createSite(orgName),
    loadSite: (id) => api.getSite(id),
    async saveDocument(id, document) {
      await api.saveDocument(id, document);
    },
    async uploadImage(siteId, file, fileName) {
      return (await api.uploadAsset(siteId, file, fileName)).url;
    },
    imageUrl(ref) {
      if (ABSOLUTE.test(ref.src)) return ref.src;
      return ref.src.startsWith("/") ? `${API_URL}${ref.src}` : ref.src;
    },
    ai: {
      usage: () => api.aiUsage(),
      draft: (siteId, request) => api.aiDraft(siteId, request),
      rewrite: (siteId, request) => api.aiRewrite(siteId, request),
      theme: (siteId, request) => api.aiTheme(siteId, request),
      altText: (siteId, assetKey) => api.aiAltText(siteId, assetKey),
      translate: (siteId, language) => api.aiTranslate(siteId, language),
      edit: (siteId, request) => api.aiEdit(siteId, request),
      addSection: (siteId, request) => api.aiAddSection(siteId, request),
    },
    messages: {
      list: (siteId) => api.listMessages(siteId),
      remove: (siteId, id) => api.deleteMessage(siteId, id),
    },
    contactEmail: {
      status: (siteId, email) => api.contactEmailStatus(siteId, email),
      verify: (siteId, email) => api.requestContactEmailVerification(siteId, email),
    },
    publish: (siteId) => api.publish(siteId),
    unpublish: (siteId) => api.unpublish(siteId),
    domains: {
      list: (siteId) => api.listDomains(siteId),
      add: (siteId, hostname, kind) => api.addDomain(siteId, hostname, kind),
      refresh: (siteId, domainId) => api.refreshDomain(siteId, domainId),
      remove: (siteId, domainId) => api.removeDomain(siteId, domainId),
    },
    deleteSite: (siteId) => api.deleteSite(siteId),
    integrations: {
      get: (orgId) => api.getIntegrations(orgId),
      setResendKey: (orgId, request) => api.setResendKey(orgId, request),
      setResendFrom: (orgId, request) => api.setResendFrom(orgId, request),
      sendResendTest: (orgId, request) => api.sendResendTest(orgId, request),
      disconnectResend: (orgId) => api.disconnectResend(orgId),
    },
  };
}

// ---- Local mode -----------------------------------------------------------

export const LOCAL_SITE_ID = "local";
export const LOCAL_DOC_KEY = "ministry.local.document";
/** Best-effort persistence of uploaded images (data URLs) so a reload keeps them. */
export const LOCAL_IMAGES_KEY = "ministry.local.images";

const PLACEHOLDER =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

function readImages(): Map<string, string> {
  try {
    const raw = localStorage.getItem(LOCAL_IMAGES_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === "object") {
      return new Map(Object.entries(parsed).filter((e): e is [string, string] => typeof e[1] === "string"));
    }
  } catch {
    // corrupted storage: start empty
  }
  return new Map();
}

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => (typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Unreadable image.")));
    reader.onerror = () => reject(new Error("Could not read the image."));
    reader.readAsDataURL(blob);
  });
}

export function createLocalBackend(): Backend {
  const images = readImages();

  function persistImages(): void {
    try {
      localStorage.setItem(LOCAL_IMAGES_KEY, JSON.stringify(Object.fromEntries(images)));
    } catch {
      // Quota exceeded: images stay available in memory for this session only.
    }
  }

  function readDocument(): SiteDocument | null {
    const raw = localStorage.getItem(LOCAL_DOC_KEY);
    if (!raw) return null;
    const parsed = SiteDocument.safeParse(JSON.parse(raw));
    if (!parsed.success) throw new Error("The saved local document is invalid.");
    return parsed.data;
  }

  function loaded(document: SiteDocument): LoadedSite {
    return { site: { id: LOCAL_SITE_ID, orgId: null, slug: slugify(document.meta.orgName), publishedUrl: null, publishedAt: null, messageCount: 0 }, document };
  }

  return {
    mode: "local",
    async listSites() {
      const doc = readDocument();
      return doc
        ? [
            {
              id: LOCAL_SITE_ID,
              slug: slugify(doc.meta.orgName),
              orgName: doc.meta.orgName,
              updatedAt: new Date().toISOString(),
              publishedUrl: null,
            },
          ]
        : [];
    },
    async createSite(orgName) {
      const document = emptySiteDocument(orgName);
      localStorage.setItem(LOCAL_DOC_KEY, JSON.stringify(document));
      return loaded(document);
    },
    async loadSite(id) {
      const doc = id === LOCAL_SITE_ID ? readDocument() : null;
      if (!doc) throw new ApiError(404, "Site not found.");
      return loaded(doc);
    },
    async saveDocument(_id, document) {
      localStorage.setItem(LOCAL_DOC_KEY, JSON.stringify(document));
    },
    async uploadImage(_siteId, file, fileName) {
      const safe = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
      const src = `local:${crypto.randomUUID()}/${safe}`;
      images.set(src, await readAsDataUrl(file));
      persistImages();
      return src;
    },
    imageUrl(ref) {
      if (ABSOLUTE.test(ref.src)) return ref.src;
      return images.get(ref.src) ?? PLACEHOLDER;
    },
  };
}
