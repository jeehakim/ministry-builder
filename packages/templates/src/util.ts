import type { Theme } from "@ministry/schema";

export function themeVars(theme: Theme): string {
  const radius = theme.radius === "none" ? "0" : theme.radius === "large" ? "18px" : "8px";
  return `:root{--primary:${theme.primary};--accent:${theme.accent};--bg:${theme.background};--text:${theme.text};--heading-font:${theme.headingFont};--body-font:${theme.bodyFont};--radius:${radius};}`;
}

/** Splits free text into paragraphs on blank lines. */
export function paragraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

export function isExternal(href: string): boolean {
  return /^https?:\/\//i.test(href);
}
