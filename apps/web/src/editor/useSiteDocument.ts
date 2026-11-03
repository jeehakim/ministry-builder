import { useCallback, useEffect, useRef, useState } from "react";
import { SiteDocument, type Section, type SectionType } from "@ministry/schema";
import type { SiteInfo } from "../api";
import { useBackend } from "../backend-context";
import { isNetworkError } from "../lib/errors";
import { can } from "../lib/roles";
import { useBeforeUnloadGuard } from "../lib/useBeforeUnloadGuard";
import { addSection, formatIssue, moveSection, removeSection, reorderSection, replaceSection, toggleHidden } from "./documentOps";

export type SaveState =
  | { kind: "saved" }
  | { kind: "unsaved" }
  | { kind: "saving" }
  | { kind: "invalid"; message: string }
  | { kind: "error"; message: string };

export type LoadState =
  | { kind: "loading" }
  /** `network` is true when the API could not be reached at all, so a retry may succeed. */
  | { kind: "error"; message: string; network: boolean }
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
  // Bumped by retry() to run the load effect again.
  const [attempt, setAttempt] = useState(0);
  // The last document known to be persisted (or loaded); autosave skips when unchanged.
  const persisted = useRef<SiteDocument | null>(null);
  // Serialises saves so an older request can never finish after a newer one.
  const queue = useRef<Promise<void>>(Promise.resolve());
  const inFlight = useRef(0);
  // The newest document handed to the save queue, so flush() never saves it twice.
  const requested = useRef<SiteDocument | null>(null);
  const latestDoc = useRef<SiteDocument | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoad({ kind: "loading" });
    backend
      .loadSite(siteId)
      .then(({ site, document }) => {
        if (cancelled) return;
        persisted.current = document;
        requested.current = null;
        setSave({ kind: "saved" });
        setLoad({ kind: "ready", site, doc: document });
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoad({ kind: "error", message: errorText(err), network: isNetworkError(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [backend, siteId, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const doc = load.kind === "ready" ? load.doc : null;
  latestDoc.current = doc;
  // Viewers never write: no edit reaches the document, and nothing is queued for saving.
  const readOnly = load.kind === "ready" && !can(load.site.role, "edit");

  /** Queues a save of `target`. Never rejects: failures land in the save state and leave `persisted` behind. */
  const persist = useCallback(
    (target: SiteDocument, data: SiteDocument): Promise<void> => {
      requested.current = target;
      setSave({ kind: "saving" });
      inFlight.current += 1;
      const run = queue.current.then(async () => {
        try {
          await backend.saveDocument(siteId, data);
          persisted.current = target;
          inFlight.current -= 1;
          if (inFlight.current === 0) setSave((current) => (current.kind === "saving" ? { kind: "saved" } : current));
        } catch (err) {
          inFlight.current -= 1;
          if (requested.current === target) requested.current = null; // let flush() retry it
          setSave({ kind: "error", message: errorText(err) });
        }
      });
      queue.current = run;
      return run;
    },
    [backend, siteId],
  );

  useEffect(() => {
    if (!doc || readOnly || doc === persisted.current) return;

    const parsed = SiteDocument.safeParse(doc);
    if (!parsed.success) {
      setSave({ kind: "invalid", message: formatIssue(parsed.error) });
      return;
    }
    setSave({ kind: "unsaved" });

    const timer = setTimeout(() => {
      if (requested.current === doc) return; // flush() already saved this exact document
      void persist(doc, parsed.data);
    }, AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [doc, persist, readOnly]);

  /** Saves pending edits now and resolves once they are stored. Throws if the document is invalid or the save fails. */
  const flush = useCallback(async (): Promise<void> => {
    const current = latestDoc.current;
    if (!current || readOnly) return;
    if (current !== persisted.current && requested.current !== current) {
      const parsed = SiteDocument.safeParse(current);
      if (!parsed.success) throw new Error(`Fix this first: ${formatIssue(parsed.error)}`);
      await persist(current, parsed.data);
    } else {
      await queue.current;
    }
    if (persisted.current !== current) throw new Error("Your latest changes could not be saved. Try again in a moment.");
  }, [persist, readOnly]);

  const unsaved = save.kind === "unsaved" || save.kind === "saving";
  useBeforeUnloadGuard(unsaved);

  const update = useCallback((fn: (doc: SiteDocument) => SiteDocument) => {
    setLoad((current) => (current.kind === "ready" && can(current.site.role, "edit") ? { ...current, doc: fn(current.doc) } : current));
  }, []);

  const updateSite = useCallback((patch: Partial<SiteInfo>) => {
    setLoad((current) => (current.kind === "ready" ? { ...current, site: { ...current.site, ...patch } } : current));
  }, []);

  return {
    load,
    save,
    retry,
    update,
    updateSite,
    flush,
    addSection: useCallback((type: SectionType) => update((d) => addSection(d, type)), [update]),
    moveSection: useCallback((id: string, dir: -1 | 1) => update((d) => moveSection(d, id, dir)), [update]),
    reorderSection: useCallback((id: string, overId: string) => update((d) => reorderSection(d, id, overId)), [update]),
    toggleHidden: useCallback((id: string) => update((d) => toggleHidden(d, id)), [update]),
    removeSection: useCallback((id: string) => update((d) => removeSection(d, id)), [update]),
    replaceSection: useCallback((section: Section) => update((d) => replaceSection(d, section)), [update]),
  };
}
