import { useEffect, useState } from "react";
import type { AiDraftRequest } from "@ministry/schema";
import { Loader2 } from "lucide-react";
import { ReferenceImagePicker } from "../components/ReferenceImagePicker";
import { SelectField } from "../components/Field";
import { assetKeyFromSrc } from "../lib/urls";
import { progressIndex, progressMessages } from "../lib/variations";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

// Mirror AiDraftRequest: the server rejects anything outside these bounds.
export const MIN_NOTES = 10;
export const MAX_NOTES = 8000;
const MAX_STYLE = 500;
const PROGRESS_INTERVAL_MS = 4000;

const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "ko", label: "Korean" },
];

export type DraftCount = "1" | "3";

/** The draft form's state, kept by the caller so a closed dialog keeps what was typed. */
export function useDraftForm() {
  const [notes, setNotes] = useState("");
  const [language, setLanguage] = useState("en");
  const [styleNotes, setStyleNotes] = useState("");
  const [reference, setReference] = useState<string | undefined>();
  const [count, setCount] = useState<DraftCount>("3");
  const trimmed = notes.trim();
  const valid = trimmed.length >= MIN_NOTES && trimmed.length <= MAX_NOTES;
  const variations: 1 | 3 = count === "1" ? 1 : 3;
  const request = (): AiDraftRequest => ({
    notes: trimmed,
    language,
    variations,
    referenceAssetKey: reference ? (assetKeyFromSrc(reference) ?? undefined) : undefined,
    styleNotes: styleNotes.trim() === "" ? undefined : styleNotes.trim(),
  });
  return { notes, setNotes, language, setLanguage, styleNotes, setStyleNotes, reference, setReference, count, setCount, trimmed, valid, variations, request };
}

export type DraftForm = ReturnType<typeof useDraftForm>;

export function DraftProgress({ variations }: { variations: 1 | 3 }) {
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

/** The fields of the draft form (notes, language, count, style, reference). The caller supplies the <form> and footer. */
export function DraftFormFields({ form, idPrefix = "draft", autoFocus = true }: { form: DraftForm; idPrefix?: string; autoFocus?: boolean }) {
  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-notes`}>Tell us about the organization</Label>
        <Textarea
          id={`${idPrefix}-notes`}
          autoFocus={autoFocus}
          className="min-h-36 resize-y"
          maxLength={MAX_NOTES}
          value={form.notes}
          onChange={(e) => form.setNotes(e.target.value)}
          placeholder={
            "Mission, programs, service times, people, and how to give. For example:\n" +
            "Grace Community Church. We help families in Fullerton find belonging. Sunday worship 10:30 AM, " +
            "Wednesday youth group, food pantry on Saturdays. Pastor Kim leads. Give through Zeffy."
          }
        />
        <p className="text-xs text-muted-foreground">
          {form.trimmed.length < MIN_NOTES
            ? `Write at least ${MIN_NOTES} characters (${form.trimmed.length} so far).`
            : `${form.trimmed.length.toLocaleString()} of ${MAX_NOTES.toLocaleString()} characters.`}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField label="Language" value={form.language} options={LANGUAGES} onChange={form.setLanguage} />
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">How many drafts</Label>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            className="w-full"
            value={form.count}
            aria-label="How many drafts"
            onValueChange={(v) => {
              if (v === "1" || v === "3") form.setCount(v);
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
        <Label htmlFor={`${idPrefix}-style`} className="text-xs text-muted-foreground">
          Style notes (optional)
        </Label>
        <Input
          id={`${idPrefix}-style`}
          maxLength={MAX_STYLE}
          value={form.styleNotes}
          onChange={(e) => form.setStyleNotes(e.target.value)}
          placeholder="Calm and earthy, like our flyer"
        />
      </div>

      <ReferenceImagePicker label="Design reference (optional)" src={form.reference} onChange={form.setReference} />
    </>
  );
}
