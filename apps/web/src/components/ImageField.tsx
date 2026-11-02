import { useId, useState } from "react";
import type { ImageRef } from "@ministry/schema";
import { useBackend } from "../backend-context";
import { useSiteId } from "../editor/EditorContext";
import { resizeToWebp } from "../lib/image";
import { btnCls, inputCls, labelCls } from "./ui";

export function ImageField(props: {
  label: string;
  value: ImageRef | undefined;
  onChange: (value: ImageRef | undefined) => void;
}) {
  const { label, value, onChange } = props;
  const backend = useBackend();
  const siteId = useSiteId();
  const inputId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setBusy(true);
    setError(null);
    try {
      const processed = await resizeToWebp(file);
      const src = await backend.uploadImage(siteId, processed.blob, processed.fileName);
      onChange({ src, alt: value?.alt ?? "", width: processed.width, height: processed.height });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <span className={labelCls}>{label}</span>
      <div className="flex items-start gap-3 rounded-md border border-dashed border-slate-300 p-2">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded bg-slate-100 text-[10px] text-slate-400">
          {value ? <img src={backend.imageUrl(value)} alt="" className="h-full w-full object-cover" /> : "No image"}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor={inputId} className={`${btnCls} cursor-pointer has-[:focus-visible]:outline-2`}>
              {busy ? "Uploading..." : value ? "Replace" : "Choose image"}
              <input
                id={inputId}
                type="file"
                accept="image/*"
                disabled={busy}
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void handleFile(file);
                }}
              />
            </label>
            {value ? (
              <button type="button" className={btnCls} onClick={() => onChange(undefined)}>
                Remove
              </button>
            ) : null}
          </div>
          {value ? (
            <input
              aria-label={`${label} alt text`}
              className={inputCls}
              placeholder="Alt text: describe the image"
              value={value.alt}
              onChange={(e) => onChange({ ...value, alt: e.target.value })}
            />
          ) : null}
          {error ? (
            <p role="alert" className="text-xs text-red-700">
              {error}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
