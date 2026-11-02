import { useEffect, useMemo, useRef, useState } from "react";
import type { SiteDocument } from "@ministry/schema";
import { renderSite } from "@ministry/templates";
import { useBackend } from "../backend-context";
import { useDebouncedValue } from "../lib/useDebouncedValue";
import { formatIssue } from "./documentOps";

export type Device = "desktop" | "mobile";

const PREVIEW_DEBOUNCE_MS = 150;

type Rendered = { ok: true; html: string } | { ok: false; message: string };

/** Live preview: the template output in a sandboxed iframe, re-rendered shortly after edits settle. */
export function Preview({ doc, device, focusSectionId }: { doc: SiteDocument; device: Device; focusSectionId: string | null }) {
  const backend = useBackend();
  const debounced = useDebouncedValue(doc, PREVIEW_DEBOUNCE_MS);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const scrollY = useRef(0);
  const [lastGood, setLastGood] = useState("");

  const rendered = useMemo<Rendered>(() => {
    try {
      return { ok: true, html: renderSite(debounced, { imageUrl: (ref) => backend.imageUrl(ref), editor: true }).html };
    } catch (err) {
      const message = err instanceof Error && "issues" in err && Array.isArray(err.issues)
        ? formatIssue({ issues: err.issues })
        : err instanceof Error
          ? err.message
          : "The preview could not be rendered.";
      return { ok: false, message };
    }
  }, [debounced, backend]);

  useEffect(() => {
    if (!rendered.ok) return;
    // Remember where the reader was so the reload after an edit does not jump to the top.
    scrollY.current = frameRef.current?.contentWindow?.scrollY ?? 0;
    setLastGood(rendered.html);
  }, [rendered]);

  useEffect(() => {
    if (!focusSectionId) return;
    const target = frameRef.current?.contentDocument?.querySelector(`[data-section-id="${CSS.escape(focusSectionId)}"]`);
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [focusSectionId]);

  function handleLoad() {
    const win = frameRef.current?.contentWindow;
    const frameDoc = frameRef.current?.contentDocument;
    if (!win || !frameDoc) return;
    win.scrollTo(0, scrollY.current);
    // Keep the preview in place: only in-page anchors navigate, everything else is inert.
    frameDoc.addEventListener("click", (e) => {
      if (!(e.target instanceof Element)) return;
      const href = e.target.closest("a")?.getAttribute("href");
      if (href && !href.startsWith("#")) e.preventDefault();
    });
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {!rendered.ok ? (
        <p role="status" className="border-b border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-900">
          Preview paused until this is fixed: {rendered.message}
        </p>
      ) : null}
      <div className="flex min-h-0 flex-1 justify-center overflow-auto bg-slate-200 p-3">
        <iframe
          ref={frameRef}
          title="Site preview"
          sandbox="allow-same-origin"
          srcDoc={lastGood}
          onLoad={handleLoad}
          className="h-full rounded-md border border-slate-300 bg-white shadow-sm transition-[width] duration-200"
          style={{ width: device === "mobile" ? 390 : "100%" }}
        />
      </div>
    </div>
  );
}
