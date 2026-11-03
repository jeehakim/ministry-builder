import { useId } from "react";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import { useBackend } from "../backend-context";
import { useImageUpload } from "../lib/useImageUpload";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

/**
 * Picks a design reference image. It is stored like any other site image
 * (resized, uploaded) and the caller gets back the `src` to hand to the AI.
 */
export function ReferenceImagePicker(props: {
  label: string;
  src: string | undefined;
  onChange: (src: string | undefined) => void;
  disabled?: boolean;
}) {
  const { label, src, onChange, disabled } = props;
  const backend = useBackend();
  const inputId = useId();
  const { upload, busy, error } = useImageUpload();

  async function handleFile(file: File) {
    const uploaded = await upload(file);
    if (uploaded) onChange(uploaded.src);
  }

  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="relative flex items-center gap-3 rounded-lg border border-dashed border-input p-2">
        {src ? (
          <div className="size-14 shrink-0 overflow-hidden rounded-md bg-muted ring-1 ring-foreground/10">
            <img src={backend.imageUrl({ src, alt: "" })} alt="Selected design reference" className="size-full object-cover" />
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-1.5">
          <input
            id={inputId}
            type="file"
            accept="image/*"
            disabled={busy || disabled}
            className="peer sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void handleFile(file);
            }}
          />
          <Button asChild variant="outline" size="sm" disabled={busy || disabled}>
            <label
              htmlFor={inputId}
              className="cursor-pointer peer-focus-visible:border-ring peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50"
            >
              {busy ? <Loader2 className="animate-spin" /> : <ImagePlus />}
              {busy ? "Uploading…" : src ? "Replace" : "Choose an image"}
            </label>
          </Button>
          {src ? (
            <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => onChange(undefined)}>
              <Trash2 />
              Remove
            </Button>
          ) : null}
        </div>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
