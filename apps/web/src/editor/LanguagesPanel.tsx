import { useState } from "react";
import { languageName, type SiteDocument } from "@ministry/schema";
import { ChevronDown, Pencil, Plus, Sparkles, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { SelectField } from "../components/Field";
import { primaryLanguageOptions } from "../lib/languages";
import { TRANSLATE_BUSY_KEY, useAi } from "./AiContext";
import { AddLanguageDialog, TranslateProgress } from "./AddLanguageDialog";
import { addLanguage, removeLanguage, setPrimaryLanguage } from "./documentOps";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";

type Confirm = { kind: "remove" | "retranslate"; code: string } | null;

/** Site & design: the primary language, the additional languages, and adding or translating them. */
export function LanguagesPanel(props: {
  doc: SiteDocument;
  update: (fn: (d: SiteDocument) => SiteDocument) => void;
  /** The language being translated right now, if any. */
  translatingTo: string | null;
  /** Resolves true when the translation was applied. */
  onTranslate: (code: string) => Promise<boolean>;
  /** Shows that language in the editor. */
  onOpenLanguage: (code: string) => void;
}) {
  const { doc, update, translatingTo, onTranslate, onOpenLanguage } = props;
  const { ai, enabled, disabledReason, busy } = useAi();
  const [adding, setAdding] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const working = busy[TRANSLATE_BUSY_KEY] === true || translatingTo !== null;
  const extras = doc.meta.languages;
  const primaryName = languageName(doc.meta.language);

  function addEmpty(code: string) {
    update((d) => addLanguage(d, code));
    onOpenLanguage(code);
    setAdding(false);
    toast.success(`Added ${languageName(code)}`, { description: `Lines you leave untranslated show in ${primaryName}.` });
  }

  function confirmed() {
    const current = confirm;
    setConfirm(null);
    if (!current) return;
    if (current.kind === "remove") {
      update((d) => removeLanguage(d, current.code));
      toast.success(`Removed ${languageName(current.code)}`);
    } else {
      void onTranslate(current.code);
    }
  }

  return (
    <section aria-labelledby="site-languages" className="space-y-4">
      <div>
        <h2 id="site-languages" className="text-sm font-semibold">
          Languages
        </h2>
        <p className="text-xs text-muted-foreground">
          Your page is written in {primaryName}. Add a language to publish a translated copy.
        </p>
      </div>

      <SelectField
        label="Main language"
        value={doc.meta.language}
        options={primaryLanguageOptions(doc).map((o) => ({ value: o.code, label: o.label }))}
        onChange={(code) => update((d) => setPrimaryLanguage(d, code))}
      />

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground">Translations</Label>
          <Button type="button" variant="outline" size="xs" onClick={() => setAdding(true)}>
            <Plus />
            Add language
          </Button>
        </div>
        {extras.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5">
            {extras.map((code) => (
              <LanguageChip
                key={code}
                code={code}
                canTranslate={ai !== null}
                translateBlockedReason={!enabled ? disabledReason : working ? "A translation is already running." : null}
                onOpen={() => onOpenLanguage(code)}
                onRetranslate={() => setConfirm({ kind: "retranslate", code })}
                onRemove={() => setConfirm({ kind: "remove", code })}
              />
            ))}
          </ul>
        ) : (
          <p className="rounded-lg border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
            No translations yet. Your page is only in {primaryName}.
          </p>
        )}
        {translatingTo && !adding ? (
          <TranslateProgress code={translatingTo} className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-muted-foreground" />
        ) : null}
      </div>

      <AddLanguageDialog
        open={adding}
        onOpenChange={setAdding}
        doc={doc}
        translatingTo={translatingTo}
        onAddEmpty={addEmpty}
        onTranslate={onTranslate}
      />

      <Dialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {confirm?.kind === "remove" ? `Remove ${languageName(confirm.code)}?` : `Re-translate ${confirm ? languageName(confirm.code) : ""}?`}
            </DialogTitle>
            <DialogDescription>
              {confirm?.kind === "remove"
                ? `The ${languageName(confirm.code)} copy of your page and all of its translated text will be deleted. Your ${primaryName} page is not affected.`
                : `The AI writes a fresh translation and replaces the current ${confirm ? languageName(confirm.code) : ""} text, including any edits you made to it.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            {confirm?.kind === "remove" ? (
              <Button type="button" variant="destructive" onClick={confirmed}>
                <Trash2 />
                Remove
              </Button>
            ) : (
              <Button type="button" onClick={confirmed}>
                <Sparkles />
                Re-translate
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function LanguageChip(props: {
  code: string;
  canTranslate: boolean;
  /** Why re-translating is unavailable right now; null when it is allowed. */
  translateBlockedReason: string | null;
  onOpen: () => void;
  onRetranslate: () => void;
  onRemove: () => void;
}) {
  const { code, canTranslate, translateBlockedReason, onOpen, onRetranslate, onRemove } = props;
  const name = languageName(code);
  return (
    <li className="flex items-center rounded-full border bg-card text-sm shadow-xs">
      <Button type="button" variant="ghost" size="sm" className="rounded-full pr-1" lang={code} onClick={onOpen} title={`Edit the ${name} text`}>
        {name}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="icon-xs" aria-label={`Actions for ${name}`} className="text-muted-foreground">
            <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onSelect={onOpen}>
            <Pencil />
            Edit the text
          </DropdownMenuItem>
          {canTranslate ? (
            <DropdownMenuItem disabled={translateBlockedReason !== null} onSelect={onRetranslate} title={translateBlockedReason ?? undefined}>
              <Sparkles />
              Re-translate with AI
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={`Remove ${name}`}
        className="mr-1 text-muted-foreground hover:text-destructive"
        onClick={onRemove}
      >
        <X />
      </Button>
    </li>
  );
}
