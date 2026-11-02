import { useEffect, useMemo, useRef, useState } from "react";
import type { SiteDocument } from "@ministry/schema";
import { renderSite } from "@ministry/templates";
import { useBackend } from "../backend-context";
import { DEFAULT_PREVIEW_SCALE, PREVIEW_FRAME, previewScale, scaledSize } from "../lib/variations";

/** Width of an element, tracked with a ResizeObserver. 0 until measured. */
function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

/**
 * A non-interactive thumbnail of a whole page: the real template output in an
 * iframe laid out at desktop width, then scaled down with a CSS transform.
 */
export function VariationPreview({ document, title }: { document: SiteDocument; title: string }) {
  const backend = useBackend();
  const { ref, width } = useElementWidth<HTMLDivElement>();

  const html = useMemo(() => {
    try {
      return renderSite(document, { imageUrl: (image) => backend.imageUrl(image) }).html;
    } catch {
      return null;
    }
  }, [document, backend]);

  const scale = width > 0 ? previewScale(width) : DEFAULT_PREVIEW_SCALE;
  const box = scaledSize(scale);

  return (
    <div
      ref={ref}
      className="relative w-full overflow-hidden rounded-lg bg-white ring-1 ring-foreground/10"
      style={{ height: box.height }}
    >
      {html ? (
        <iframe
          title={`Preview of ${title}`}
          srcDoc={html}
          sandbox=""
          tabIndex={-1}
          loading="lazy"
          className="pointer-events-none absolute top-0 left-0 origin-top-left border-0 bg-white"
          style={{ width: PREVIEW_FRAME.width, height: PREVIEW_FRAME.height, transform: `scale(${scale})` }}
        />
      ) : (
        <p className="grid h-full place-items-center px-4 text-center text-xs text-muted-foreground">Preview unavailable for this draft.</p>
      )}
    </div>
  );
}
