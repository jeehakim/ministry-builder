import { useEffect, useState, type FormEvent } from "react";
import type { AiDraftRequest } from "@ministry/schema";
import { Loader2, Sparkles } from "lucide-react";
import { ReferenceImagePicker } from "../components/ReferenceImagePicker";
import { SelectField } from "../components/Field";
import { assetKeyFromSrc } from "../lib/urls";
import { progressIndex, progressMessages } from "../lib/variations";
import { DRAFT_BUSY_KEY, useAi } from "./AiContext";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

// Mirror AiDraftRequest: the server rejects anything outside these bounds.
const MIN_NOTES = 10;
const MAX_NOTES = 8000;
const MAX_STYLE = 500;
const PROGRESS_INTERVAL_MS = 4000;

const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "ko", label: "Korean" },
];

type Count = "1" | "3";

function DraftProgress({ variations }: { variations: 1 | 3 }) {
  const messages = progressMessages(variations);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Date.now() - started), PROGRESS_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);
  const message = messages[progressIndex(elapsed, messages.length, PROGRESS_INTERVAL_MS)];
  return (
    <div className="flex flex-col items-center gap-3 py-10 text-center">
      <Loader2 className="size-6 animate-spin text-brand" aria-hidden="true" />
      <p role="status" aria-live="polite" className="text-sm font-medium">
        {message}
      </p>
      <p className="max-w-sm text-xs text-muted-foreground">
        This takes 30 to 90 seconds. You can close this window and keep editing; we will tell you when the{" "}
        {variations === 3 ? "drafts are" : "draft is"} ready.
      </p>
    </div>
  );
}

export function DraftDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onGenerate: (request: AiDraftRequest) => void;
}) {
  const { open, onOpenChange, onGenerate } = props;
  const { enabled, disabledReason, busy } = useAi();
  const working = busy[DRAFT_BUSY_KEY] === true;

  // The form state lives here, not in the dialog content, so closing and reopening keeps what was typed.
  const [notes, setNotes] = useState("");
  const [language, setLanguage] = useState("en");
  const [styleNotes, setStyleNotes] = useState("");
  const [reference, setReference] = useState<string | undefined>();
  const [count, setCount] = useState<Count>("3");

  const trimmed = notes.trim();
  const valid = trimmed.length >= MIN_NOTES && trimmed.length <= MAX_NOTES;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid || working || !enabled) return;
    onGenerate({
      notes: trimmed,
      language,
      variations: count === "1" ? 1 : 3,
      referenceAssetKey: reference ? (assetKeyFromSrc(reference) ?? undefined) : undefined,
      styleNotes: styleNotes.trim() === "" ? undefined : styleNotes.trim(),
    });
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
            <DraftProgress variations={count === "1" ? 1 : 3} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Keep editing
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="draft-notes">Tell us about the organization</Label>
              <Textarea
                id="draft-notes"
                autoFocus
                className="min-h-36 resize-y"
                maxLength={MAX_NOTES}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={
                  "Mission, programs, service times, people, and how to give. For example:\n" +
                  "Grace Community Church. We help families in Fullerton find belonging. Sunday worship 10:30 AM, " +
                  "Wednesday youth group, food pantry on Saturdays. Pastor Kim leads. Give through Zeffy."
                }
              />
              <p className="text-xs text-muted-foreground">
                {trimmed.length < MIN_NOTES
                  ? `Write at least ${MIN_NOTES} characters (${trimmed.length} so far).`
                  : `${trimmed.length.toLocaleString()} of ${MAX_NOTES.toLocaleString()} characters.`}
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <SelectField label="Language" value={language} options={LANGUAGES} onChange={setLanguage} />
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">How many drafts</Label>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  className="w-full"
                  value={count}
                  aria-label="How many drafts"
                  onValueChange={(v) => {
                    if (v === "1" || v === "3") setCount(v);
                  }}
                >
                  <ToggleGroupItem value="1" className="flex-1">
                    1 draft
                  </ToggleGroupItem>
                  <ToggleGroupItem value="3" className="flex-1">
                    3 variations
                  </ToggleGroupItem>
                </ToggleGroup>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="draft-style" className="text-xs text-muted-foreground">
                Style notes (optional)
              </Label>
              <Input
                id="draft-style"
                maxLength={MAX_STYLE}
                value={styleNotes}
                onChange={(e) => setStyleNotes(e.target.value)}
                placeholder="Calm and earthy, like our flyer"
              />
            </div>

            <ReferenceImagePicker label="Design reference (optional)" src={reference} onChange={setReference} />

            {!enabled ? (
              <p role="status" className="rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                {disabledReason}
              </p>
            ) : null}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!valid || !enabled}>
                <Sparkles />
                {count === "1" ? "Write my draft" : "Write 3 drafts"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
