/** Editor-only accent used to outline sections the AI proposes to change. Distinct from any site theme. */
export const PROPOSED_OUTLINE_COLOR = "#6d5dfc";

function escapeAttr(id: string): string {
  return id.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * A <style> block that outlines the given sections in the preview and tags them "Proposed".
 * Empty when there is nothing to outline. Only the editor's preview ever injects it; exports
 * and published pages never see it.
 */
export function proposedOutlineStyle(sectionIds: readonly string[]): string {
  if (sectionIds.length === 0) return "";
  const selectors = sectionIds.map((id) => `[data-section-id="${escapeAttr(id)}"]`);
  const box = `${selectors.join(",")}{outline:2px solid ${PROPOSED_OUTLINE_COLOR};outline-offset:-2px;position:relative}`;
  const tag =
    `${selectors.map((s) => `${s}::after`).join(",")}{content:"Proposed";position:absolute;top:8px;right:8px;z-index:9;` +
    `padding:2px 8px;border-radius:999px;background:${PROPOSED_OUTLINE_COLOR};color:#fff;font:600 11px/1.6 system-ui,sans-serif;pointer-events:none}`;
  return `<style data-editor-proposed>${box}${tag}</style>`;
}

/** Adds the outline style to rendered page HTML, just before </body>. */
export function withProposedOutline(html: string, sectionIds: readonly string[]): string {
  const style = proposedOutlineStyle(sectionIds);
  if (!style) return html;
  const at = html.lastIndexOf("</body>");
  return at < 0 ? html + style : `${html.slice(0, at)}${style}${html.slice(at)}`;
}
