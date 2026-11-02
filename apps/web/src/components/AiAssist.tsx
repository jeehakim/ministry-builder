import { useId, useState, type FormEvent } from "react";
import { AI_REWRITE_PRESETS } from "@ministry/schema";
import { Loader2, Sparkles } from "lucide-react";
import { useAi } from "../editor/AiContext";
import { useLatest } from "../lib/useLatest";
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Mirrors AiRewriteRequest: the server rejects longer text or instructions. */
const MAX_TEXT = 4000;
const MAX_INSTRUCTION = 300;

/**
 * Sparkles button that rewrites a field with an AI preset or a custom instruction.
 * Renders nothing in local mode, where there is no AI client.
 */
export function AiAssist(props: { label: string; value: string; context: string; onApply: (text: string) => void }) {
  const { label, value, context, onApply } = props;
  const { ai, enabled, disabledReason, busy, runRewrite } = useAi();
  const key = `rewrite:${useId()}`;
  const applyLatest = useLatest(onApply);
  const [customOpen, setCustomOpen] = useState(false);
  const [instruction, setInstruction] = useState("");

  if (!ai) return null;

  const working = busy[key] === true;
  const empty = value.trim() === "";
  const tooLong = value.length > MAX_TEXT;
  const reason = !enabled
    ? disabledReason
    : empty
      ? "Write something first, then AI can improve it."
      : tooLong
        ? `Too long for AI rewriting (${MAX_TEXT} characters at most).`
        : null;

  async function rewrite(how: string) {
    const text = await runRewrite(key, { text: value, instruction: how, context });
    if (text !== null) applyLatest.current(text);
  }

  function submitCustom(e: FormEvent) {
    e.preventDefault();
    const how = instruction.trim();
    if (!how) return;
    setCustomOpen(false);
    setInstruction("");
    void rewrite(how);
  }

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={`Rewrite ${label} with AI`}
            title={reason ?? `Rewrite ${label} with AI`}
            disabled={reason !== null || working}
            className="text-muted-foreground hover:text-brand"
          >
            {working ? <Loader2 className="animate-spin" /> : <Sparkles />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          {AI_REWRITE_PRESETS.map((preset) => (
            <DropdownMenuItem key={preset.id} onSelect={() => void rewrite(preset.instruction)}>
              {preset.label}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setCustomOpen(true)}>Custom instruction…</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={customOpen} onOpenChange={setCustomOpen}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={submitCustom}>
            <DialogHeader>
              <DialogTitle>Rewrite {label}</DialogTitle>
              <DialogDescription>Tell the AI what to change. The field is replaced with the result.</DialogDescription>
            </DialogHeader>
            <div className="my-4 space-y-1.5">
              <Label htmlFor={`${key}-instruction`}>Instruction</Label>
              <Input
                id={`${key}-instruction`}
                autoFocus
                maxLength={MAX_INSTRUCTION}
                value={instruction}
                placeholder="Mention our Sunday potluck"
                onChange={(e) => setInstruction(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCustomOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={instruction.trim() === ""}>
                <Sparkles />
                Rewrite
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
