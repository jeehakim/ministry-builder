import { useId, useState, type DragEvent } from "react";
import type { ImageRef } from "@ministry/schema";
import { ImagePlus, Loader2, Trash2, Upload } from "lucide-react";
import { useBackend } from "../backend-context";
import { useSiteId } from "../editor/EditorContext";
import { resizeToWebp } from "../lib/image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

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
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file.");
      return;
    }
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

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) void handleFile(file);
  }

  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
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
                <Button asChild variant="outline" size="sm" disabled={busy}>
                  <label htmlFor={inputId} className="cursor-pointer">
                    {busy ? <Loader2 className="animate-spin" /> : <ImagePlus />}
                    Replace
                  </label>
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => onChange(undefined)}>
                  <Trash2 />
                  Remove
                </Button>
              </div>
              <Input
                aria-label={`${label} alt text`}
                placeholder="Describe the image for screen readers"
                value={value.alt}
                onChange={(e) => onChange({ ...value, alt: e.target.value })}
              />
            </div>
          </div>
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
          disabled={busy}
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
