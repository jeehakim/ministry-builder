#!/usr/bin/env node
// End-to-end: build and publish the Bridge World Foundation site through the production API.
// Auth: X-Staff-Token read from STAFF_TOKEN_FILE (default: ./staff-token.txt next to this script).
// Steps: create site -> upload 3 images -> AI draft (3 variations, Korean) -> save each variation's HTML
// for review -> pick one -> attach images -> save -> publish -> transfer the org to OWNER_EMAIL.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const API = process.env.API_URL ?? "https://api.build.shofar.ai";
const TOKEN = readFileSync(process.env.STAFF_TOKEN_FILE ?? join(here, "staff-token.txt"), "utf8").trim();
const OWNER_EMAIL = process.env.OWNER_EMAIL ?? "";
const PICK = process.env.PICK; // index of the variation to use; when unset, the script stops after saving previews
const SLUG = process.env.SLUG ?? "bridgeworld";
const ORG = "Bridge World Foundation";
const imgDir = join(here, "bwf-images");
const out = join(here, "bwf-out");
mkdirSync(out, { recursive: true });

async function api(path, init = {}) {
  const res = await fetch(API + path, { ...init, headers: { "X-Staff-Token": TOKEN, ...(init.headers ?? {}) } });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} -> ${res.status}: ${typeof body === "string" ? body.slice(0, 300) : JSON.stringify(body).slice(0, 300)}`);
  return body;
}
const json = (method, body) => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

// 1. Site (reuse if it exists)
let siteId;
const existing = (await api("/admin/sites")).sites?.find((s) => s.slug === SLUG);
if (existing) { siteId = existing.id; console.log("reusing site", siteId); }
else { const created = await api("/sites", json("POST", { orgName: ORG, slug: SLUG })); siteId = created.site.id; console.log("created site", siteId); }

// 2. Images
const uploads = {};
for (const name of ["hero", "about", "community"]) {
  const form = new FormData();
  form.append("file", new Blob([readFileSync(join(imgDir, `${name}.webp`))], { type: "image/webp" }), `${name}.webp`);
  uploads[name] = await api(`/sites/${siteId}/assets`, { method: "POST", body: form });
  console.log("uploaded", name, uploads[name].key);
}
const credits = JSON.parse(readFileSync(join(imgDir, "credits.json"), "utf8"));
const alt = Object.fromEntries(credits.map((c) => [c.file.replace(".webp", ""), c.license === "CC BY 4.0" ? `Church interior in colored light (photo: ${c.artist.replace(/<[^>]+>/g, "")}, CC BY 4.0)` : ""]));

// 3. Draft
if (!process.env.SKIP_DRAFT) {
  const notes = readFileSync(join(imgDir, "notes.txt"), "utf8");
  console.log("drafting 3 variations (this takes a minute or two)…");
  const t0 = Date.now();
  const draft = await api(`/sites/${siteId}/ai/draft`, json("POST", {
    notes, language: "ko", variations: 3,
    referenceAssetKey: uploads.hero.key,
    styleNotes: "Professional, warm and hopeful. Bridge imagery. Keep the six core value names in English as headings with Korean descriptions. Navy and gold palette.",
  }));
  console.log(`draft done in ${Math.round((Date.now() - t0) / 1000)}s; group ${draft.variationGroupId}`);
  writeFileSync(join(out, "draft.json"), JSON.stringify(draft, null, 2));
  draft.variations.forEach((v, i) => console.log(`  [${i}] ${v.label} — template ${v.document.theme.templateId}, ${v.document.sections.length} sections`));
}
const draft = JSON.parse(readFileSync(join(out, "draft.json"), "utf8"));
if (PICK === undefined) { console.log("Set PICK=<index> to continue."); process.exit(0); }

// 4. Pick, attach images, save
const doc = structuredClone(draft.variations[Number(PICK)].document);
const ref = (name, w, h) => ({ src: uploads[name].url, alt: alt[name] || "", width: w, height: h });
const altText = {
  about: "빛으로 물든 교회 예배당 내부 (사진: Dnwinterburn, CC BY 4.0)",
  community: "교실에서 함께 배우는 학생들과 교사",
};
for (const s of doc.sections) {
  if (s.type === "hero") s.image = { ...ref("about", 1600, 1066), alt: altText.about };
  if (s.type === "about") s.image = { ...ref("community", 1600, 1026), alt: altText.community };
  if (s.type === "programs") for (const it of s.items) delete it.image;
}
doc.meta.orgName = ORG;
const saved = await api(`/sites/${siteId}/document`, json("PUT", doc));
console.log("saved version", saved.versionId);

// 5. Publish
const pub = await api(`/sites/${siteId}/publish`, { method: "POST" });
console.log("published:", pub.url);

// 6. Hand over
const site = await api(`/sites/${siteId}`);
const orgId = site.site.orgId;
if (orgId) { const t = await api(`/orgs/${orgId}/transfer`, json("POST", { email: OWNER_EMAIL })); console.log("transferred org", t); }
