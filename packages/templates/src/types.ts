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
  /** Language switcher entries (current one marked). Omitted or empty = no switcher. */
  languageLinks?: LanguageLink[];
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
