import { z } from "zod";

/**
 * The site document is the single contract shared by the editor, the AI
 * provider adapter (structured output) and the templates. Keep it small and
 * additive: new section types are appended to the union, never reshaped.
 */

export const ImageRef = z.object({
  /** Path relative to the site root, e.g. "images/hero.webp" (export) or an R2 key (hosted). */
  src: z.string().min(1),
  alt: z.string().default(""),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});
export type ImageRef = z.infer<typeof ImageRef>;

export const Link = z.object({
  label: z.string().min(1),
  href: z.string().min(1),
});
export type Link = z.infer<typeof Link>;

/** Hex colors only (#rgb, #rrggbb, #rrggbbaa). Theme values are written into a <style> block, so they must never carry CSS or HTML syntax. */
export const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
/** A CSS font-family list: names, quotes, commas, spaces and hyphens. No braces, angle brackets, slashes, semicolons or backslashes. */
export const FONT_STACK = /^[A-Za-z0-9 ,'"-]{1,200}$/;

const hexColor = (fallback: string) => z.string().regex(HEX_COLOR, "Use a hex color like #1f4e79").default(fallback);
const fontStack = (fallback: string) => z.string().regex(FONT_STACK, "Font names only").default(fallback);

export const Theme = z.object({
  templateId: z.string().regex(/^[a-z][a-z0-9-]{0,40}$/, "Unknown template id").default("classic"),
  /** Hex color strings. Templates expose these as CSS custom properties. */
  primary: hexColor("#1f4e79"),
  accent: hexColor("#d9a441"),
  background: hexColor("#ffffff"),
  text: hexColor("#1a1a1a"),
  headingFont: fontStack("Georgia, 'Times New Roman', serif"),
  bodyFont: fontStack("system-ui, -apple-system, 'Segoe UI', sans-serif"),
  heroStyle: z.enum(["image", "solid", "split"]).default("image"),
  radius: z.enum(["none", "small", "large"]).default("small"),
});
export type Theme = z.infer<typeof Theme>;

export const Meta = z.object({
  orgName: z.string().min(1),
  tagline: z.string().default(""),
  description: z.string().default(""),
  logo: ImageRef.optional(),
  /** Primary language (BCP 47 code such as "en", "ko", "es"). The default page is rendered in it. */
  language: z.string().default("en"),
  /** @deprecated use `languages`; kept so older documents still parse. */
  secondaryLanguage: z.string().optional(),
  /** Additional languages, each published at /<lang>/ with content from `translations`. */
  languages: z.array(z.string().min(2).max(10)).default([]),
});
export type Meta = z.infer<typeof Meta>;

// ---- Sections ----------------------------------------------------------

const base = { id: z.string().min(1), hidden: z.boolean().default(false) };

export const HeroSection = z.object({
  ...base,
  type: z.literal("hero"),
  heading: z.string().min(1),
  subheading: z.string().default(""),
  image: ImageRef.optional(),
  primaryCta: Link.optional(),
  secondaryCta: Link.optional(),
});

export const AboutSection = z.object({
  ...base,
  type: z.literal("about"),
  heading: z.string().default("About us"),
  body: z.string().min(1),
  image: ImageRef.optional(),
});

export const ProgramsSection = z.object({
  ...base,
  type: z.literal("programs"),
  heading: z.string().default("What we do"),
  items: z
    .array(
      z.object({
        title: z.string().min(1),
        description: z.string().default(""),
        image: ImageRef.optional(),
        link: Link.optional(),
      }),
    )
    .default([]),
});

export const EventsSection = z.object({
  ...base,
  type: z.literal("events"),
  heading: z.string().default("Events & times"),
  items: z
    .array(
      z.object({
        title: z.string().min(1),
        /** Free text such as "Sundays 10:30 AM" or "Dec 24, 7 PM" (no date math in v0). */
        when: z.string().default(""),
        where: z.string().default(""),
        description: z.string().default(""),
      }),
    )
    .default([]),
});

export const TeamSection = z.object({
  ...base,
  type: z.literal("team"),
  heading: z.string().default("Our team"),
  members: z
    .array(
      z.object({
        name: z.string().min(1),
        role: z.string().default(""),
        bio: z.string().default(""),
        photo: ImageRef.optional(),
      }),
    )
    .default([]),
});

export const StoriesSection = z.object({
  ...base,
  type: z.literal("stories"),
  heading: z.string().default("Stories"),
  items: z
    .array(
      z.object({
        quote: z.string().min(1),
        attribution: z.string().default(""),
      }),
    )
    .default([]),
});

export const GiveSection = z.object({
  ...base,
  type: z.literal("give"),
  heading: z.string().default("Give"),
  body: z.string().default(""),
  /** External giving links only (Zeffy, Givebutter, PayPal, Tithe.ly...). We never process payments. */
  links: z.array(Link).default([]),
});

export const ContactSection = z.object({
  ...base,
  type: z.literal("contact"),
  heading: z.string().default("Contact"),
  /** Where contact-form messages are delivered. Private unless `showEmail` is on. */
  email: z.string().default(""),
  /** Print the address on the public page (exposes it to scrapers). Off by default. */
  showEmail: z.boolean().default(false),
  phone: z.string().default(""),
  address: z.string().default(""),
  /** Optional form endpoint (Web3Forms, Formspree, or the hosted-tier Worker). */
  formEndpoint: z.string().optional(),
  social: z.array(Link).default([]),
});

export const Section = z.discriminatedUnion("type", [
  HeroSection,
  AboutSection,
  ProgramsSection,
  EventsSection,
  TeamSection,
  StoriesSection,
  GiveSection,
  ContactSection,
]);
export type Section = z.infer<typeof Section>;
export type SectionType = Section["type"];

/**
 * A translation overlay: only the translatable strings, keyed the same way as the
 * primary content. Missing fields fall back to the primary language. Arrays are
 * merged by index so images and links keep their non-text data.
 */
export const TranslationOverlay = z.object({
  meta: z.object({ tagline: z.string().optional(), description: z.string().optional() }).default({}),
  /** Keyed by section id; values are partial section objects holding strings and arrays of partial items. */
  sections: z.record(z.string(), z.record(z.string(), z.unknown())).default({}),
});
export type TranslationOverlay = z.infer<typeof TranslationOverlay>;

export const SiteDocument = z.object({
  version: z.literal(1).default(1),
  meta: Meta,
  theme: Theme.default({}),
  sections: z.array(Section).default([]),
  /** Overlays keyed by language code (see `meta.languages`). */
  translations: z.record(z.string(), TranslationOverlay).default({}),
});
export type SiteDocument = z.infer<typeof SiteDocument>;

export const SECTION_TYPES: SectionType[] = [
  "hero",
  "about",
  "programs",
  "events",
  "team",
  "stories",
  "give",
  "contact",
];

/** Parse and apply defaults; throws a ZodError on invalid input. */
export function parseSiteDocument(input: unknown): SiteDocument {
  return SiteDocument.parse(input);
}

/** A starter document for a brand-new site. */
export function emptySiteDocument(orgName = "Your organization"): SiteDocument {
  return SiteDocument.parse({
    meta: { orgName, tagline: "A short line about who you are" },
    theme: {},
    sections: [
      { id: "hero", type: "hero", heading: `Welcome to ${orgName}`, subheading: "We are glad you are here." },
      { id: "about", type: "about", body: "Tell visitors who you are, who you serve, and why it matters." },
      { id: "programs", type: "programs", items: [] },
      { id: "events", type: "events", items: [] },
      { id: "give", type: "give", body: "Your gift keeps this work going.", links: [] },
      { id: "contact", type: "contact" },
    ],
  });
}

/** Returns a fresh id for a new section of the given type. */
export function newSectionId(type: SectionType, existing: Section[]): string {
  let n = 1;
  const ids = new Set(existing.map((s) => s.id));
  while (ids.has(`${type}-${n}`)) n++;
  return `${type}-${n}`;
}

// ---- Localization ------------------------------------------------------

export const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  ko: "한국어",
  es: "Español",
  zh: "中文",
  ja: "日本語",
  pt: "Português",
  fr: "Français",
  de: "Deutsch",
  vi: "Tiếng Việt",
  tl: "Tagalog",
};

export function languageName(code: string): string {
  return LANGUAGE_NAMES[code] ?? code.toUpperCase();
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Deep merge for overlays: strings from the overlay win, arrays merge by index, everything else keeps the primary value. */
function mergeLocalized(primary: unknown, overlay: unknown): unknown {
  if (overlay === undefined || overlay === null) return primary;
  if (typeof primary === "string") return typeof overlay === "string" ? overlay : primary;
  if (Array.isArray(primary)) {
    if (!Array.isArray(overlay)) return primary;
    return primary.map((item, i) => mergeLocalized(item, overlay[i]));
  }
  if (isPlainObject(primary)) {
    if (!isPlainObject(overlay)) return primary;
    const out: Record<string, unknown> = { ...primary };
    for (const key of Object.keys(primary)) {
      if (key in overlay) out[key] = mergeLocalized(primary[key], overlay[key]);
    }
    return out;
  }
  return primary;
}

/** Keeps only the strings in `localized` that differ from `primary` (arrays by index). Returns undefined when nothing differs. */
function diffLocalized(primary: unknown, localized: unknown): unknown {
  if (typeof primary === "string") return typeof localized === "string" && localized !== primary ? localized : undefined;
  if (Array.isArray(primary)) {
    if (!Array.isArray(localized)) return undefined;
    const arr = primary.map((item, i) => diffLocalized(item, localized[i]));
    return arr.some((v) => v !== undefined) ? arr.map((v) => v ?? {}) : undefined;
  }
  if (isPlainObject(primary)) {
    if (!isPlainObject(localized)) return undefined;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(primary)) {
      const d = diffLocalized(primary[key], localized[key]);
      if (d !== undefined) out[key] = d;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return undefined;
}

/** All languages of a document, primary first, without duplicates. */
export function siteLanguages(doc: SiteDocument): string[] {
  const out = [doc.meta.language];
  for (const l of doc.meta.languages) if (!out.includes(l)) out.push(l);
  return out;
}

/** Returns the document with its text replaced by the overlay for `lang`. The primary language returns the document unchanged. */
export function localizeDocument(doc: SiteDocument, lang: string): SiteDocument {
  if (lang === doc.meta.language) return doc;
  const overlay = doc.translations[lang];
  if (!overlay) return { ...doc, meta: { ...doc.meta, language: lang } };
  const meta = { ...doc.meta, language: lang, ...(overlay.meta.tagline !== undefined ? { tagline: overlay.meta.tagline } : {}), ...(overlay.meta.description !== undefined ? { description: overlay.meta.description } : {}) };
  const sections = doc.sections.map((s) => {
    const o = overlay.sections[s.id];
    return o ? (mergeLocalized(s, o) as Section) : s;
  });
  return { ...doc, meta, sections };
}

/** Stores an edited localized section back into the overlay for `lang`, keeping only what differs from the primary text. */
export function setTranslatedSection(doc: SiteDocument, lang: string, localized: Section): SiteDocument {
  const primary = doc.sections.find((s) => s.id === localized.id);
  if (!primary || lang === doc.meta.language) return doc;
  const overlay = doc.translations[lang] ?? { meta: {}, sections: {} };
  const diff = diffLocalized(primary, localized) as Record<string, unknown> | undefined;
  const sections = { ...overlay.sections };
  if (diff) sections[localized.id] = diff;
  else delete sections[localized.id];
  return { ...doc, translations: { ...doc.translations, [lang]: { ...overlay, sections } } };
}

export function setTranslatedMeta(doc: SiteDocument, lang: string, patch: { tagline?: string; description?: string }): SiteDocument {
  if (lang === doc.meta.language) return doc;
  const overlay = doc.translations[lang] ?? { meta: {}, sections: {} };
  const meta = { ...overlay.meta };
  for (const key of ["tagline", "description"] as const) {
    const v = patch[key];
    if (v === undefined) continue;
    if (v === doc.meta[key]) delete meta[key];
    else meta[key] = v;
  }
  return { ...doc, translations: { ...doc.translations, [lang]: { ...overlay, meta } } };
}
