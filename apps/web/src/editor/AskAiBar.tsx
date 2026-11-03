import { useEffect, useRef, type KeyboardEvent } from "react";
import { AI_EDIT_MAX_INSTRUCTION } from "@ministry/schema";
import { ArrowUp, ChevronDown, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { DESIGN_LABEL, SITE_TEXT_LABEL, WHOLE_PAGE_LABEL } from "./askAi";

/** What the scope chip is set to: follow the selection, or one of the fixed scopes. */
export type ScopeChoice = "selection" | "meta" | "theme" | "page";

const PLACEHOLDERS: Record<ScopeChoice, string> = {
  selection: "Warmer, and mention childcare…",
  meta: "A tagline that says who we serve…",
  theme: "Calmer colors, like a forest…",
  page: "Make the whole page more welcoming…",
};

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * One input, always at the bottom of the sidebar, that edits the scope shown on the chip.
 * ⌘K focuses it from anywhere in the editor.
 */
export function AskAiBar(props: {
  /** Label of the effective scope (the chip). */
  scopeLabel: string;
  /** What "Follow selection" currently resolves to, for the menu. */
  selectionLabel: string;
  choice: ScopeChoice;
  onChoice: (choice: ScopeChoice) => void;
  instruction: string;
  onInstructionChange: (text: string) => void;
  onSubmit: () => void;
  busy: boolean;
  /** Why the bar is off (local mode, no key, editing a translation); null when it works. */
  disabledReason: string | null;
  /** Bumped by the editor to focus the input (⌘K, ghost prompts, suggestions). */
  focusKey: number;
}) {
  const { scopeLabel, selectionLabel, choice, onChoice, instruction, onInstructionChange, onSubmit, busy, disabledReason, focusKey } = props;
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const disabled = disabledReason !== null;
  const canSubmit = !disabled && !busy && instruction.trim() !== "";

  useEffect(() => {
    if (focusKey === 0) return;
    // Deferred: a menu that just closed (Suggestions, the scope chip) returns focus to its trigger first.
    const timer = setTimeout(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }, 0);
    return () => clearTimeout(timer);
  }, [focusKey]);

  function handleKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (canSubmit) onSubmit();
    }
  }

  return (
    <div className="shrink-0 border-t bg-sidebar p-2">
      <div
        className={cn(
          "rounded-xl border bg-card shadow-xs transition-colors focus-within:border-brand/50 focus-within:ring-3 focus-within:ring-brand/15",
          disabled && "opacity-70",
        )}
      >
        <div className="flex items-center gap-1.5 px-2 pt-1.5">
          <Sparkles className="size-3.5 shrink-0 text-brand" aria-hidden="true" />
          <span className="text-xs font-medium">Ask AI</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="xs"
                disabled={disabled}
                aria-label={`Scope: ${scopeLabel}. Change scope`}
                className="ml-1 max-w-[55%] rounded-full border-brand/30 bg-brand-soft/60 text-brand hover:bg-brand-soft"
              >
                <span className="truncate">{scopeLabel}</span>
                <ChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuRadioGroup value={choice} onValueChange={(v) => onChoice(v as ScopeChoice)}>
                <DropdownMenuRadioItem value="selection">
                  <span className="flex flex-col">
                    <span>Follow selection</span>
                    <span className="text-xs text-muted-foreground">Now: {selectionLabel}</span>
                  </span>
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="meta">{SITE_TEXT_LABEL}</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="theme">{DESIGN_LABEL}</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="page">{WHOLE_PAGE_LABEL}</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <span className="ml-auto hidden items-center gap-0.5 sm:flex" aria-hidden="true">
            <Kbd>{isMac ? "⌘" : "Ctrl"}</Kbd>
            <Kbd>K</Kbd>
          </span>
        </div>
        <div className="flex items-end gap-1 p-1.5">
          <Textarea
            ref={inputRef}
            aria-label={`Ask AI to change ${scopeLabel}`}
            rows={1}
            maxLength={AI_EDIT_MAX_INSTRUCTION}
            value={instruction}
            disabled={disabled}
            placeholder={disabled ? (disabledReason ?? undefined) : PLACEHOLDERS[choice]}
            onChange={(e) => onInstructionChange(e.target.value)}
            onKeyDown={handleKey}
            className="max-h-32 min-h-8 resize-none border-0 bg-transparent px-1.5 py-1 text-sm shadow-none focus-visible:ring-0 dark:bg-transparent"
          />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button type="button" size="icon-sm" aria-label="Send to AI" disabled={!canSubmit} onClick={onSubmit} className="shrink-0 rounded-full">
                {busy ? <Loader2 className="animate-spin" /> : <ArrowUp />}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">{busy ? "Asking the AI…" : "Send (Enter)"}</TooltipContent>
          </Tooltip>
        </div>
      </div>
      <p className="mt-1 px-1 text-[11px] text-muted-foreground">
        {disabled ? disabledReason : "You review every change before it is applied."}
      </p>
    </div>
  );
}
