import { newSectionId, Section, SiteDocument, Theme, type AiChange, type AiEditScope, type Meta } from "@ministry/schema";
import type { EditTarget } from "./provider";

/** Section fields the AI may not change: media, machine-readable values and layout flags. Copied back from the original. */
const KEEP_KEYS = ["id", "type", "hidden", "showEmail", "formEndpoint"] as const;

const SUMMARY_MAX = 320;

function words(s: string): number {
  return s.trim() === "" ? 0 : s.trim().split(/\s+/).length;
}

/** One line a model can read in a glance: name, tagline and the sections in order with their headings and item counts. */
export function pageSummary(doc: SiteDocument): string {
  const head = [doc.meta.orgName, doc.meta.tagline].filter((s) => s.trim() !== "").join(" — ");
  const parts = doc.sections.map((s) => {
    const heading = "heading" in s && s.heading ? ` "${s.heading}"` : "";
    const count =
      s.type === "programs" || s.type === "events" || s.type === "stories"
        ? ` (${s.items.length})`
        : s.type === "team"
          ? ` (${s.members.length})`
          : s.type === "about"
            ? ` (${words(s.body)} words)`
            : "";
    return `${s.type}${heading}${count}${s.hidden ? " [hidden]" : ""}`;
  });
  const line = `${head}. Language ${doc.meta.language}. Sections: ${parts.join(", ") || "none"}.`;
  return line.length > SUMMARY_MAX ? `${line.slice(0, SUMMARY_MAX - 1)}…` : line;
}

/** The content the model receives for a scope, or null when a section id is not on the page. */
export function editTarget(doc: SiteDocument, scope: AiEditScope): EditTarget | null {
  switch (scope.kind) {
    case "section": {
      const section = doc.sections.find((s) => s.id === scope.id);
      return section ? { kind: "section", section } : null;
    }
    case "meta":
      return { kind: "meta", meta: doc.meta };
    case "theme":
      return { kind: "theme", theme: doc.theme };
    case "page":
      return { kind: "page", meta: doc.meta, sections: doc.sections };
  }
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const MEDIA_KEYS = new Set(["image", "photo", "logo"]);

/** Image references reduced to their alt text, recursively: the model can write alt text but never sees or returns a src. */
function stripMedia(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripMedia);
  if (!isObj(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (MEDIA_KEYS.has(key)) {
      if (isObj(child)) out[key] = { alt: typeof child.alt === "string" ? child.alt : "" };
      continue;
    }
    if (key === "formEndpoint" || key === "showEmail") continue;
    out[key] = stripMedia(child);
  }
  return out;
}

/** The JSON a model receives for a scope: the scoped content only, media reduced to alt text. */
export function modelContent(target: EditTarget): unknown {
  switch (target.kind) {
    case "section":
      return stripMedia(target.section);
    case "meta":
      return { orgName: target.meta.orgName, tagline: target.meta.tagline, description: target.meta.description };
    case "theme":
      return target.theme;
    case "page":
      return {
        meta: { orgName: target.meta.orgName, tagline: target.meta.tagline, description: target.meta.description },
        sections: target.sections.map(stripMedia),
      };
  }
}

/** Copies an image reference from `from` onto `to` when both items have one, keeping alt text the model wrote. */
function restoreImage(from: Record<string, unknown>, to: Record<string, unknown>, key: string): void {
  const original = from[key];
  if (!isObj(original)) {
    delete to[key];
    return;
  }
  const proposed = isObj(to[key]) ? to[key] : {};
  const alt = typeof proposed.alt === "string" ? proposed.alt : "";
  to[key] = { ...original, alt: alt || (typeof original.alt === "string" ? original.alt : "") };
}

function restoreItems(before: Record<string, unknown>, after: Record<string, unknown>, listKey: string, imageKey: string): void {
  const originals = Array.isArray(before[listKey]) ? (before[listKey] as unknown[]) : [];
  const proposed = Array.isArray(after[listKey]) ? (after[listKey] as unknown[]) : [];
  after[listKey] = proposed.map((item, i) => {
    if (!isObj(item)) return item;
    const original = originals[i];
    const next = { ...item };
    if (isObj(original)) restoreImage(original, next, imageKey);
    else delete next[imageKey];
    return next;
  });
}

/**
 * Makes a model-written section safe to apply: the id, type and layout flags come from the
 * original, and image references (src, size) are restored by position so the model can
 * neither invent nor lose media. Alt text the model wrote is kept. Returns null when the
 * result still does not parse as that section type.
 */
export function conformSection(before: Section, proposed: unknown): Section | null {
  if (!isObj(proposed)) return null;
  const next: Record<string, unknown> = { ...proposed };
  const original = before as unknown as Record<string, unknown>;
  for (const key of KEEP_KEYS) {
    if (key in original) next[key] = original[key];
    else delete next[key];
  }
  if ("image" in original || "image" in next) restoreImage(original, next, "image");
  if (before.type === "programs") restoreItems(original, next, "items", "image");
  if (before.type === "team") restoreItems(original, next, "members", "photo");
  const parsed = Section.safeParse(next);
  return parsed.success && parsed.data.type === before.type ? parsed.data : null;
}

/** Only the organization name, tagline and description are the AI's to write; logo and languages stay. */
export function conformMeta(before: Meta, proposed: unknown): Meta | null {
  if (!isObj(proposed)) return null;
  const text = (key: "orgName" | "tagline" | "description") => (typeof proposed[key] === "string" ? (proposed[key] as string) : before[key]);
  const next: Meta = { ...before, orgName: text("orgName").trim() || before.orgName, tagline: text("tagline"), description: text("description") };
  return next;
}

/** A template id the registry does not know keeps the current one, so the page never switches to a missing template. */
export function conformTheme(before: Theme, proposed: unknown, knownTemplateIds: readonly string[]): Theme | null {
  const parsed = Theme.safeParse(proposed);
  if (!parsed.success) return null;
  const templateId = knownTemplateIds.includes(parsed.data.templateId) ? parsed.data.templateId : before.templateId;
  return { ...parsed.data, templateId };
}

/**
 * Turns one model option into validated changes against the document. Targets the
 * model was not asked about, unknown section ids and malformed objects are dropped;
 * an option that keeps nothing usable yields an empty list.
 */
export function conformOption(
  doc: SiteDocument,
  scope: AiEditScope,
  option: { label: string; changes: { target: string; after: unknown }[] },
  knownTemplateIds: readonly string[],
): AiChange[] {
  const out: AiChange[] = [];
  const seen = new Set<string>();
  for (const change of option.changes) {
    if (seen.has(change.target)) continue;
    seen.add(change.target);
    const label = option.label.trim() || undefined;
    if (change.target === "meta") {
      if (scope.kind !== "meta" && scope.kind !== "page") continue;
      const after = conformMeta(doc.meta, change.after);
      if (after) out.push({ target: "meta", before: doc.meta, after, label });
      continue;
    }
    if (change.target === "theme") {
      if (scope.kind !== "theme") continue;
      const after = conformTheme(doc.theme, change.after, knownTemplateIds);
      if (after) out.push({ target: "theme", before: doc.theme, after, label });
      continue;
    }
    if (scope.kind === "section" ? scope.id !== change.target : scope.kind !== "page") continue;
    const before = doc.sections.find((s) => s.id === change.target);
    if (!before) continue;
    const after = conformSection(before, change.after);
    if (after) out.push({ target: change.target, before, after, label });
  }
  return out;
}

/** A model-written section becomes a real one: validated, with a fresh id and no media. */
export function conformNewSection(doc: SiteDocument, proposed: unknown): Section | null {
  if (!isObj(proposed)) return null;
  const draft: Record<string, unknown> = { ...proposed, hidden: false };
  delete draft.image;
  delete draft.formEndpoint;
  if (Array.isArray(draft.items)) draft.items = draft.items.map((it) => (isObj(it) ? { ...it, image: undefined } : it));
  if (Array.isArray(draft.members)) draft.members = draft.members.map((m) => (isObj(m) ? { ...m, photo: undefined } : m));
  const typed = Section.safeParse({ ...draft, id: "pending" });
  if (!typed.success) return null;
  return { ...typed.data, id: newSectionId(typed.data.type, doc.sections) };
}
