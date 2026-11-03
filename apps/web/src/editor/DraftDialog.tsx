import type { FormEvent } from "react";
import type { AiDraftRequest } from "@ministry/schema";
import { Sparkles } from "lucide-react";
import { DRAFT_BUSY_KEY, useAi } from "./AiContext";
import { DraftFormFields, DraftProgress, useDraftForm } from "./DraftForm";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function DraftDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onGenerate: (request: AiDraftRequest) => void;
}) {
  const { open, onOpenChange, onGenerate } = props;
  const { enabled, disabledReason, busy } = useAi();
  const working = busy[DRAFT_BUSY_KEY] === true;
  // The form state lives here, not in the dialog content, so closing and reopening keeps what was typed.
  const form = useDraftForm();

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!form.valid || working || !enabled) return;
    onGenerate(form.request());
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Draft with AI</DialogTitle>
          <DialogDescription>
            Paste what you know. The AI writes a complete page you can edit field by field.
          </DialogDescription>
        </DialogHeader>

        {working ? (
          <>
            <DraftProgress variations={form.variations} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Keep editing
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <DraftFormFields form={form} />

            {!enabled ? (
              <p role="status" className="rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                {disabledReason}
              </p>
            ) : null}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!form.valid || !enabled}>
                <Sparkles />
                {form.count === "1" ? "Write my draft" : "Write 3 drafts"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
