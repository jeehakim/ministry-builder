import { useState } from "react";
import type { Theme } from "@ministry/schema";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { ReferenceImagePicker } from "../components/ReferenceImagePicker";
import { assetKeyFromSrc } from "../lib/urls";
import { THEME_BUSY_KEY, useAi } from "./AiContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const MAX_DESCRIPTION = 500;

/** "Match a design reference": derive colors, fonts and hero style from an image or a description. */
export function ThemeReference({ onApply }: { onApply: (theme: Theme) => void }) {
  const { ai, enabled, disabledReason, busy, runTheme } = useAi();
  const [reference, setReference] = useState<string | undefined>();
  const [description, setDescription] = useState("");

  if (!ai) {
    return (
      <p className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
        <Sparkles className="mr-1 inline size-3.5" aria-hidden="true" />
        Match a design reference: {disabledReason}
      </p>
    );
  }

  const working = busy[THEME_BUSY_KEY] === true;
  const referenceAssetKey = reference ? (assetKeyFromSrc(reference) ?? undefined) : undefined;
  const text = description.trim();
  const ready = referenceAssetKey !== undefined || text !== "";

  async function apply() {
    const result = await runTheme({ referenceAssetKey, description: text === "" ? undefined : text });
    if (!result) return;
    onApply(result.theme);
    toast.success("Design updated", { description: result.rationale });
  }

  return (
    <section aria-labelledby="theme-reference" className="space-y-3 rounded-lg border bg-muted/30 p-3">
      <div>
        <h3 id="theme-reference" className="flex items-center gap-1.5 text-sm font-medium">
          <Sparkles className="size-3.5 text-brand" aria-hidden="true" />
          Match a design reference
        </h3>
        <p className="text-xs text-muted-foreground">
          Upload a flyer or screenshot, or describe the look. Colors, fonts and hero style update to match.
        </p>
      </div>
      <ReferenceImagePicker label="Reference image" src={reference} onChange={setReference} disabled={working} />
      <div className="space-y-1.5">
        <Label htmlFor="theme-description" className="text-xs text-muted-foreground">
          Or describe it
        </Label>
        <Input
          id="theme-description"
          maxLength={MAX_DESCRIPTION}
          value={description}
          disabled={working}
          placeholder="Calm, earthy, serif headings"
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <Button
        type="button"
        size="sm"
        disabled={!enabled || !ready || working}
        title={enabled ? undefined : (disabledReason ?? undefined)}
        onClick={() => void apply()}
      >
        {working ? <Loader2 className="animate-spin" /> : <Sparkles />}
        {working ? "Matching…" : "Apply"}
      </Button>
    </section>
  );
}
