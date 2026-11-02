import { useCallback, useState } from "react";
import type { SiteDocument } from "@ministry/schema";
import { resolveEditingLang } from "../lib/languages";

/**
 * Which language the editor is showing. The choice is kept as a request and resolved
 * against the document, so removing that language (or changing the primary) quietly
 * returns the editor to the primary language.
 */
export function useEditingLanguage(doc: SiteDocument) {
  const [requested, setRequested] = useState<string | null>(null);
  const active = resolveEditingLang(doc, requested);
  const setEditingLang = useCallback((code: string) => setRequested(code), []);
  return { active, translating: active !== doc.meta.language, setEditingLang };
}
