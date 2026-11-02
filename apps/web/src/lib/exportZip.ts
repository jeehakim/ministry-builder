import { collectImages, renderSite, renderThanksPage } from "@ministry/templates";
import type { ImageRef, SiteDocument } from "@ministry/schema";
import type { Backend } from "../backend";
import { slugify, uniqueFileName } from "./files";
import { formActionUrl } from "./messages";

/**
 * Builds the export ZIP: index.html plus images/<file> for every image ref.
 * Images are fetched through `backend.imageUrl`, so hosted URLs and local data
 * URLs go through the same path.
 *
 * In API mode the contact form posts to the platform endpoint for `siteSlug`, so a
 * self-hosted copy still delivers messages, and a thanks/ page is included. In local
 * mode there is no platform: the form renders only if the user set a custom endpoint.
 */
export async function buildExportZip(doc: SiteDocument, backend: Backend, siteSlug: string): Promise<Blob> {
  const refs = collectImages(doc);
  const used = new Set<string>();
  const nameBySrc = new Map<string, string>();
  const files: { name: string; blob: Blob }[] = [];
  const failed: string[] = [];

  for (const ref of refs) {
    if (nameBySrc.has(ref.src)) continue;
    try {
      const res = await fetch(backend.imageUrl(ref));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const name = uniqueFileName(ref.src, blob.type, used);
      nameBySrc.set(ref.src, name);
      files.push({ name, blob });
    } catch {
      failed.push(ref.src);
    }
  }
  if (failed.length > 0) {
    throw new Error(`Could not fetch ${failed.length} image(s) for the export. Remove or re-upload them and try again.`);
  }

  const imageUrl = (ref: ImageRef): string => {
    const name = nameBySrc.get(ref.src);
    return name ? `images/${name}` : ref.src;
  };
  const formAction = backend.mode === "api" ? formActionUrl(siteSlug) : undefined;
  const { html } = renderSite(doc, { imageUrl, editor: false, formAction });

  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  zip.file("index.html", html);
  if (formAction) zip.file("thanks/index.html", renderThanksPage(doc, { backHref: "../" }));
  for (const f of files) zip.file(`images/${f.name}`, f.blob);
  return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
}

export function exportFileName(doc: SiteDocument, siteSlug: string, mode: Backend["mode"]): string {
  const slug = mode === "local" ? slugify(doc.meta.orgName) : siteSlug;
  return `${slug}.zip`;
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
