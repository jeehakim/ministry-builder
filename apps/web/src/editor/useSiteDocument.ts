import { useCallback, useEffect, useRef, useState } from "react";
import { SiteDocument, type Section, type SectionType } from "@ministry/schema";
import type { SiteInfo } from "../api";
import { useBackend } from "../backend-context";
import { addSection, formatIssue, moveSection, removeSection, reorderSection, replaceSection, toggleHidden } from "./documentOps";

export type SaveState =
  | { kind: "saved" }
  | { kind: "unsaved" }
  | { kind: "saving" }
  | { kind: "invalid"; message: string }
  | { kind: "error"; message: string };

export type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; site: SiteInfo; doc: SiteDocument };

const AUTOSAVE_MS = 1000;

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong.";
}

/** Owns the document: loading, immutable updates and debounced autosave. */
export function useSiteDocument(siteId: string) {
  const backend = useBackend();
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const [save, setSave] = useState<SaveState>({ kind: "saved" });
  // The last document known to be persisted (or loaded); autosave skips when unchanged.
  const persisted = useRef<SiteDocument | null>(null);
  // Serialises saves so an older request can never finish after a newer one.
  const queue = useRef<Promise<void>>(Promise.resolve());
  const inFlight = useRef(0);

  useEffect(() => {
    let cancelled = false;
    setLoad({ kind: "loading" });
    backend
      .loadSite(siteId)
      .then(({ site, document }) => {
        if (cancelled) return;
        persisted.current = document;
        setSave({ kind: "saved" });
        setLoad({ kind: "ready", site, doc: document });
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoad({ kind: "error", message: errorText(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [backend, siteId]);

  const doc = load.kind === "ready" ? load.doc : null;

  useEffect(() => {
    if (!doc || doc === persisted.current) return;

    const parsed = SiteDocument.safeParse(doc);
    if (!parsed.success) {
      setSave({ kind: "invalid", message: formatIssue(parsed.error) });
      return;
    }
    setSave({ kind: "unsaved" });

    const timer = setTimeout(() => {
      setSave({ kind: "saving" });
      inFlight.current += 1;
      queue.current = queue.current.then(async () => {
        try {
          await backend.saveDocument(siteId, parsed.data);
          persisted.current = doc;
          inFlight.current -= 1;
          if (inFlight.current === 0) setSave((current) => (current.kind === "saving" ? { kind: "saved" } : current));
        } catch (err) {
          inFlight.current -= 1;
          setSave({ kind: "error", message: errorText(err) });
        }
      });
    }, AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [doc, backend, siteId]);

  const unsaved = save.kind === "unsaved" || save.kind === "saving";
  useEffect(() => {
    if (!unsaved) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved]);

  const update = useCallback((fn: (doc: SiteDocument) => SiteDocument) => {
    setLoad((current) => (current.kind === "ready" ? { ...current, doc: fn(current.doc) } : current));
  }, []);

  return {
    load,
    save,
    update,
    addSection: useCallback((type: SectionType) => update((d) => addSection(d, type)), [update]),
    moveSection: useCallback((id: string, dir: -1 | 1) => update((d) => moveSection(d, id, dir)), [update]),
    reorderSection: useCallback((id: string, overId: string) => update((d) => reorderSection(d, id, overId)), [update]),
    toggleHidden: useCallback((id: string) => update((d) => toggleHidden(d, id)), [update]),
    removeSection: useCallback((id: string) => update((d) => removeSection(d, id)), [update]),
    replaceSection: useCallback((section: Section) => update((d) => replaceSection(d, section)), [update]),
  };
}
