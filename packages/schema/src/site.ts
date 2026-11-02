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

export const Theme = z.object({
  templateId: z.string().default("classic"),
  /** CSS color strings. Templates expose these as CSS custom properties. */
  primary: z.string().default("#1f4e79"),
  accent: z.string().default("#d9a441"),
  background: z.string().default("#ffffff"),
  text: z.string().default("#1a1a1a"),
  headingFont: z.string().default("Georgia, 'Times New Roman', serif"),
  bodyFont: z.string().default("system-ui, -apple-system, 'Segoe UI', sans-serif"),
  heroStyle: z.enum(["image", "solid", "split"]).default("image"),
  radius: z.enum(["none", "small", "large"]).default("small"),
});
export type Theme = z.infer<typeof Theme>;

export const Meta = z.object({
  orgName: z.string().min(1),
  tagline: z.string().default(""),
  description: z.string().default(""),
  logo: ImageRef.optional(),
  language: z.string().default("en"),
  /** ISO code of an optional second language rendered as a toggle. */
  secondaryLanguage: z.string().optional(),
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
  email: z.string().default(""),
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

export const SiteDocument = z.object({
  version: z.literal(1).default(1),
  meta: Meta,
  theme: Theme.default({}),
  sections: z.array(Section).default([]),
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
