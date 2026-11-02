import { emptySiteDocument, SiteDocument, type ImageRef } from "@ministry/schema";
import { createApiClient, ApiError, type GetToken, type LoadedSite, type SiteSummary } from "./api";
import { API_URL } from "./env";
import { slugify } from "./lib/files";

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
    return { site: { id: LOCAL_SITE_ID, slug: slugify(document.meta.orgName) }, document };
  }

  return {
    mode: "local",
    async listSites() {
      const doc = readDocument();
      return doc
        ? [{ id: LOCAL_SITE_ID, slug: slugify(doc.meta.orgName), orgName: doc.meta.orgName, updatedAt: new Date().toISOString() }]
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
