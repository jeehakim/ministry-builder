import { useId, useState, type DragEvent } from "react";
import type { ImageRef } from "@ministry/schema";
import { ImagePlus, Loader2, Sparkles, Trash2, Upload } from "lucide-react";
import { useBackend } from "../backend-context";
import { useAi } from "../editor/AiContext";
import { assetKeyFromSrc } from "../lib/urls";
import { useImageUpload } from "../lib/useImageUpload";
import { useLatest } from "../lib/useLatest";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export function ImageField(props: {
  label: string;
  value: ImageRef | undefined;
  onChange: (value: ImageRef | undefined) => void;
  /**
   * Editing a translation: the picture itself cannot change, only its alt text.
   * Pass `lockAlt` as well where the alt text has no translation slot (the logo).
   */
  locked?: boolean;
  lockAlt?: boolean;
}) {
  const { label, value, onChange, locked = false, lockAlt = false } = props;
  const backend = useBackend();
  const { ai, enabled, disabledReason, busy: aiBusy, runAltText } = useAi();
  const inputId = useId();
  const altKey = `alt:${inputId}`;
  const { upload, busy, error } = useImageUpload();
  const [dragging, setDragging] = useState(false);
  const valueRef = useLatest(value);
  const onChangeRef = useLatest(onChange);

  async function handleFile(file: File) {
    const uploaded = await upload(file);
    if (uploaded) {
      onChangeRef.current({
        src: uploaded.src,
        alt: valueRef.current?.alt ?? "",
        width: uploaded.width,
        height: uploaded.height,
      });
    }
  }

  async function writeAltText() {
    if (!value) return;
    const alt = await runAltText(altKey, value.src);
    // Read the latest value: the user may have edited other fields while the AI was thinking.
    const current = valueRef.current;
    if (alt !== null && current && current.src === value.src) onChangeRef.current({ ...current, alt });
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (locked) return;
    const file = e.dataTransfer.files[0];
    if (file) void handleFile(file);
  }

  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!locked) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          "rounded-lg border border-dashed p-2 transition-colors",
          dragging ? "border-brand bg-brand-soft" : "border-input",
        )}
      >
        {value ? (
          <div className="flex items-start gap-3">
            <div className="relative size-16 shrink-0 overflow-hidden rounded-md bg-muted ring-1 ring-foreground/10">
              <img src={backend.imageUrl(value)} alt="" className="size-full object-cover" />
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex flex-wrap items-center gap-1.5">
                {locked ? (
                  <Button type="button" variant="outline" size="sm" disabled>
                    <ImagePlus />
                    Replace
                  </Button>
                ) : (
                  <Button asChild variant="outline" size="sm" disabled={busy}>
                    <label htmlFor={inputId} className="cursor-pointer">
                      {busy ? <Loader2 className="animate-spin" /> : <ImagePlus />}
                      Replace
                    </label>
                  </Button>
                )}
                <Button type="button" variant="ghost" size="sm" disabled={locked} onClick={() => onChange(undefined)}>
                  <Trash2 />
                  Remove
                </Button>
                {ai && !locked && assetKeyFromSrc(value.src) ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={!enabled || aiBusy[altKey] === true}
                    title={enabled ? "Describe this image for screen readers" : (disabledReason ?? undefined)}
                    onClick={() => void writeAltText()}
                  >
                    {aiBusy[altKey] === true ? <Loader2 className="animate-spin" /> : <Sparkles />}
                    Write alt text
                  </Button>
                ) : null}
              </div>
              <Input
                aria-label={`${label} alt text`}
                placeholder="Describe the image for screen readers"
                value={value.alt}
                disabled={lockAlt}
                onChange={(e) => onChange({ ...value, alt: e.target.value })}
              />
            </div>
          </div>
        ) : locked ? (
          <p className="px-3 py-4 text-center text-xs text-muted-foreground">No image</p>
        ) : (
          <label
            htmlFor={inputId}
            className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-md px-3 py-5 text-center text-sm text-muted-foreground hover:bg-muted/60"
          >
            {busy ? <Loader2 className="size-5 animate-spin" /> : <Upload className="size-5" />}
            <span>
              <span className="font-medium text-foreground">{busy ? "Uploading…" : "Choose an image"}</span>
              {busy ? null : " or drop it here"}
            </span>
            <span className="text-xs">Resized to 1600px and converted to WebP in your browser</span>
          </label>
        )}
        <input
          id={inputId}
          type="file"
          accept="image/*"
          disabled={busy || locked}
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void handleFile(file);
          }}
        />
      </div>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
