import { useEffect, useMemo, useRef, useState } from "react";
import type { SiteDocument } from "@ministry/schema";
import { renderSite } from "@ministry/templates";
import { AlertTriangle, Lock } from "lucide-react";
import { useBackend } from "../backend-context";
import { langFromHash, type LanguageLink } from "../lib/languages";
import { useDebouncedValue } from "../lib/useDebouncedValue";
import { useLatest } from "../lib/useLatest";
import { formatIssue } from "./documentOps";
import { cn } from "@/lib/utils";

export type Device = "desktop" | "mobile";

const PREVIEW_DEBOUNCE_MS = 150;

type Rendered = { ok: true; html: string } | { ok: false; message: string };

/** Live preview: the template output in a sandboxed iframe inside a browser-style frame. */
export function Preview({
  doc,
  device,
  hostname,
  focusSectionId,
  languageLinks,
  onSelectLanguage,
}: {
  doc: SiteDocument;
  device: Device;
  hostname: string;
  focusSectionId: string | null;
  /** Entries for the page's language switcher; hrefs are `#lang-<code>` hashes. */
  languageLinks?: LanguageLink[];
  /** Called when the visitor clicks a language in the preview. */
  onSelectLanguage?: (code: string) => void;
}) {
  const backend = useBackend();
  // Debounced together, so the switcher's "current" language never disagrees with the text shown.
  const input = useMemo(() => ({ doc, languageLinks }), [doc, languageLinks]);
  const debounced = useDebouncedValue(input, PREVIEW_DEBOUNCE_MS);
  const selectLanguage = useLatest(onSelectLanguage);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const scrollY = useRef(0);
  const [lastGood, setLastGood] = useState("");

  const rendered = useMemo<Rendered>(() => {
    try {
      return { ok: true, html: renderSite(debounced.doc, { imageUrl: (ref) => backend.imageUrl(ref), editor: true, formAction: "#", languageLinks: debounced.languageLinks }).html };
    } catch (err) {
      const message =
        err instanceof Error && "issues" in err && Array.isArray(err.issues)
          ? formatIssue({ issues: err.issues })
          : err instanceof Error
            ? err.message
            : "The preview could not be rendered.";
      return { ok: false, message };
    }
  }, [debounced, backend]);

  useEffect(() => {
    if (!rendered.ok) return;
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
    frameDoc.addEventListener("click", (e) => {
      // The target belongs to the iframe's realm, so check it against the frame's own Element.
      const FrameElement = frameDoc.defaultView?.Element;
      if (!FrameElement || !(e.target instanceof FrameElement)) return;
      const href = e.target.closest("a")?.getAttribute("href");
      const lang = langFromHash(href);
      if (lang) {
        e.preventDefault();
        selectLanguage.current?.(lang);
        return;
      }
      if (href && !href.startsWith("#")) e.preventDefault();
    });
  }

  const mobile = device === "mobile";

  return (
    <div className="flex h-full min-h-0 flex-col">
      {!rendered.ok ? (
        <p role="status" className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
          <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
          Preview paused until this is fixed: {rendered.message}
        </p>
      ) : null}
      <div className="preview-canvas flex min-h-0 flex-1 justify-center overflow-auto p-4 sm:p-6">
        <div
          className={cn(
            "flex h-full flex-col overflow-hidden rounded-xl bg-background shadow-lg ring-1 ring-foreground/10 transition-[width] duration-300 ease-out",
            mobile ? "w-[390px]" : "w-full",
          )}
        >
          <div className="flex h-9 shrink-0 items-center gap-2 border-b bg-muted/60 px-3">
            <span className="flex gap-1.5" aria-hidden="true">
              <span className="size-2.5 rounded-full bg-foreground/15" />
              <span className="size-2.5 rounded-full bg-foreground/15" />
              <span className="size-2.5 rounded-full bg-foreground/15" />
            </span>
            <span className="mx-auto flex h-6 max-w-[70%] min-w-0 items-center gap-1.5 rounded-md bg-background px-2 text-[11px] text-muted-foreground ring-1 ring-foreground/10">
              <Lock className="size-3 shrink-0" aria-hidden="true" />
              <span className="truncate">{hostname}</span>
            </span>
          </div>
          <iframe
            ref={frameRef}
            title="Site preview"
            sandbox="allow-same-origin"
            srcDoc={lastGood}
            onLoad={handleLoad}
            className="min-h-0 w-full flex-1 bg-white"
          />
        </div>
      </div>
    </div>
  );
}
