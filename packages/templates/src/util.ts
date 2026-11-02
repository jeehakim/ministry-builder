import type { Theme } from "@ministry/schema";

/**
 * Defense in depth for values that land inside <style>: the schema already restricts them to hex
 * colors and font names, but anything that could close the style block or open a tag is escaped
 * as a CSS hex escape so a stale or bypassed document can never inject markup.
 */
export function cssSafe(value: string): string {
  return value.replace(/[<>{}\\;/]/g, (c) => `\\${c.charCodeAt(0).toString(16)} `);
}

export function themeVars(theme: Theme): string {
  const radius = theme.radius === "none" ? "0" : theme.radius === "large" ? "18px" : "8px";
  const v = (s: string) => cssSafe(s);
  return `:root{--primary:${v(theme.primary)};--accent:${v(theme.accent)};--bg:${v(theme.background)};--text:${v(theme.text)};--heading-font:${v(theme.headingFont)};--body-font:${v(theme.bodyFont)};--radius:${radius};}`;
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
