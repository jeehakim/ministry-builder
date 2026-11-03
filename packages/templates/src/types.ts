import type { SiteDocument, ImageRef, Theme } from "@ministry/schema";
import type { ReactElement } from "react";

export interface RenderOptions {
  /** Maps an image reference to the URL the rendered HTML should use. */
  imageUrl: (ref: ImageRef) => string;
  /** When true, sections get data-section-id attributes for editor scroll-to. */
  editor?: boolean;
  /**
   * Where the contact form posts (the platform endpoint that emails the section's address).
   * Omitted = the form renders only when the user set a custom `formEndpoint`; "#" = disabled preview form.
   */
  formAction?: string;
  /** Set by renderSite from the document; templates read it for fixed UI strings. */
  language?: string;
  /**
   * Absolute URL of the page being rendered (e.g. https://sites.shofar.io/slug/en/). Enables the
   * canonical link, Open Graph tags, absolute hreflang alternates and Organization structured data.
   */
  canonicalUrl?: string;
  /** Language switcher entries (current one marked). Omitted or empty = no switcher. */
  languageLinks?: LanguageLink[];
  /**
   * Active fundraising campaigns of the site, for the cards in the Give section. Filled in by the
   * publisher from the campaigns table; omitted in previews and exports, where no cards render.
   */
  campaigns?: CampaignCard[];
}

/** What a Give-section card and a campaign page need to know about a campaign. Money in minor units. */
export interface CampaignCard {
  id: string;
  slug: string;
  title: string;
  summary: string;
  /** Link to the campaign page, relative to the page being rendered. */
  href: string;
  goalAmount: number;
  raisedAmount: number;
  currency: string;
  /** 0 to 100. */
  percent: number;
  coverImage?: ImageRef;
  deadline?: string;
}

export interface LanguageLink {
  code: string;
  label: string;
  href: string;
  current: boolean;
}

export interface Template {
  id: string;
  name: string;
  description: string;
  /** Theme defaults this template looks best with. */
  themeDefaults: Partial<Theme>;
  /** CSS for the whole page. Receives the theme so it can emit custom properties. */
  css: (theme: Theme) => string;
  /** Renders the <body> contents. */
  Body: (props: { doc: SiteDocument; options: RenderOptions }) => ReactElement;
}
