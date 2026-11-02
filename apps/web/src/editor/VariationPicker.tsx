import type { AiDraftResponse, AiDraftVariation } from "@ministry/schema";
import { templates } from "@ministry/templates";
import { Check, PenLine } from "lucide-react";
import { VariationPreview } from "./VariationPreview";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function templateName(variation: AiDraftVariation): string {
  const id = variation.document.theme.templateId;
  return templates[id]?.name ?? id;
}

function VariationCard({ variation, onUse }: { variation: AiDraftVariation; onUse: () => void }) {
  return (
    <article aria-label={variation.label} className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-3 shadow-xs">
      <VariationPreview document={variation.document} title={variation.label} />
      <div className="flex items-end justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-medium">{variation.label}</h3>
          <p className="truncate text-xs text-muted-foreground">{templateName(variation)} template</p>
        </div>
        <Button type="button" size="sm" onClick={onUse}>
          <Check />
          Use this
          <span className="sr-only"> draft: {variation.label}</span>
        </Button>
      </div>
    </article>
  );
}

/** Side-by-side drafts from the AI. Choosing one hands its document to `onUse`. */
export function VariationPicker(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  result: AiDraftResponse | null;
  onUse: (variation: AiDraftVariation) => void;
  onWriteAnother: () => void;
}) {
  const { open, onOpenChange, result, onUse, onWriteAnother } = props;
  const variations = result?.variations ?? [];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{variations.length === 1 ? "Your draft" : "Pick a starting point"}</DialogTitle>
          <DialogDescription>
            Using a draft replaces the current page, and you can still edit every field. The other drafts stay available from the
            Variations button.
          </DialogDescription>
        </DialogHeader>
        <div className={variations.length === 1 ? "mx-auto w-full max-w-sm" : "grid gap-3 sm:grid-cols-2 lg:grid-cols-3"}>
          {variations.map((variation) => (
            <VariationCard key={variation.versionId} variation={variation} onUse={() => onUse(variation)} />
          ))}
        </div>
        <DialogFooter className="sm:justify-between">
          <Button type="button" variant="ghost" onClick={onWriteAnother}>
            <PenLine />
            Write another draft
          </Button>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
