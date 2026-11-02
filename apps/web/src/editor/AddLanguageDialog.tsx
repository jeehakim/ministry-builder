import { useEffect, useMemo, useState } from "react";
import type { SiteDocument } from "@ministry/schema";
import { Loader2, Plus, Sparkles } from "lucide-react";
import { SelectField } from "../components/Field";
import { addableLanguages, translateProgressMessages } from "../lib/languages";
import { progressIndex } from "../lib/variations";
import { TRANSLATE_BUSY_KEY, useAi } from "./AiContext";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const PROGRESS_INTERVAL_MS = 5000;

/** Rotating status line shown while a translation is being written. */
export function TranslateProgress({ code, className }: { code: string; className?: string }) {
  const messages = translateProgressMessages(code);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Date.now() - started), PROGRESS_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);
  const message = messages[progressIndex(elapsed, messages.length, PROGRESS_INTERVAL_MS)];
  return (
    <div className={className}>
      <Loader2 className="size-5 shrink-0 animate-spin text-brand motion-reduce:animate-none" aria-hidden="true" />
      <p role="status" aria-live="polite" className="text-sm font-medium">
        {message}
      </p>
    </div>
  );
}

export function AddLanguageDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  doc: SiteDocument;
  /** The language being translated right now, if any. */
  translatingTo: string | null;
  onAddEmpty: (code: string) => void;
  /** Resolves true when the translation was applied, so the dialog can close. */
  onTranslate: (code: string) => Promise<boolean>;
}) {
  const { open, onOpenChange, doc, translatingTo, onAddEmpty, onTranslate } = props;
  const { ai, enabled, disabledReason, busy } = useAi();
  const options = useMemo(() => addableLanguages(doc), [doc]);
  const [code, setCode] = useState("");
  const working = busy[TRANSLATE_BUSY_KEY] === true || translatingTo !== null;

  // Keep the selection valid: pick the first free language on open, and again if the list changes under it.
  const valid = options.some((o) => o.code === code);
  useEffect(() => {
    if (open && !valid) setCode(options[0]?.code ?? "");
  }, [open, valid, options]);

  async function translate() {
    if (!valid) return;
    if (await onTranslate(code)) onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a language</DialogTitle>
          <DialogDescription>
            Visitors can switch to it from the top of your page. Start from a blank translation, or let AI translate the whole page for you to review.
          </DialogDescription>
        </DialogHeader>

        {working && translatingTo ? (
          <>
            <TranslateProgress code={translatingTo} className="flex flex-col items-center gap-3 py-8 text-center" />
            <p className="text-center text-xs text-muted-foreground">
              You can close this window and keep editing; we will tell you when it is ready.
            </p>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Keep editing
              </Button>
            </DialogFooter>
          </>
        ) : options.length === 0 ? (
          <>
            <p className="text-sm text-muted-foreground">Every available language has already been added.</p>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <SelectField
              label="Language"
              value={valid ? code : ""}
              options={options.map((o) => ({ value: o.code, label: o.label }))}
              onChange={setCode}
            />
            {ai && !enabled ? (
              <p role="status" className="rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                {disabledReason}
              </p>
            ) : null}
            {!ai ? (
              <p role="status" className="rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                {disabledReason} You can still add the language and type the translation yourself.
              </p>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" disabled={!valid || working} onClick={() => valid && onAddEmpty(code)}>
                <Plus />
                Add empty
              </Button>
              {ai ? (
                <Button type="button" disabled={!valid || !enabled || working} onClick={() => void translate()}>
                  <Sparkles />
                  Translate with AI
                </Button>
              ) : null}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
