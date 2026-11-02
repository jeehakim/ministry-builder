/** Web-safe pairings only: nothing to download, so exported sites stay fast and self-contained. */
export interface FontPair {
  id: string;
  label: string;
  headingFont: string;
  bodyFont: string;
}

const SANS = "system-ui, -apple-system, 'Segoe UI', sans-serif";

export const FONT_PAIRS: FontPair[] = [
  { id: "classic", label: "Classic: Georgia + system sans", headingFont: "Georgia, 'Times New Roman', serif", bodyFont: SANS },
  { id: "modern", label: "Modern: system sans", headingFont: SANS, bodyFont: SANS },
  {
    id: "editorial",
    label: "Editorial: Palatino + Georgia",
    headingFont: "Palatino, 'Palatino Linotype', 'Book Antiqua', serif",
    bodyFont: "Georgia, 'Times New Roman', serif",
  },
  {
    id: "friendly",
    label: "Friendly: Trebuchet + Verdana",
    headingFont: "'Trebuchet MS', 'Segoe UI', sans-serif",
    bodyFont: "Verdana, Geneva, sans-serif",
  },
];

export function findFontPair(headingFont: string, bodyFont: string): FontPair | undefined {
  return FONT_PAIRS.find((p) => p.headingFont === headingFont && p.bodyFont === bodyFont);
}
