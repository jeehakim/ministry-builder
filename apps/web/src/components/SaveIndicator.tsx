import { AlertCircle, Check, CircleDot, Loader2 } from "lucide-react";
import type { SaveState } from "../editor/useSiteDocument";
import { cn } from "@/lib/utils";

export function SaveIndicator({ state }: { state: SaveState }) {
  const { text, tone, Icon, spin } = describe(state);
  return (
    <span
      role="status"
      aria-live="polite"
      title={state.kind === "error" ? state.message : undefined}
      className={cn("inline-flex max-w-56 items-center gap-1.5 rounded-full px-2 py-0.5 text-xs", tone)}
    >
      <Icon className={cn("size-3.5 shrink-0", spin && "animate-spin")} aria-hidden="true" />
      <span className="truncate">{text}</span>
    </span>
  );
}

function describe(state: SaveState) {
  switch (state.kind) {
    case "saved":
      return { text: "Saved", tone: "text-emerald-700 bg-emerald-50 dark:text-emerald-300 dark:bg-emerald-950/50", Icon: Check, spin: false };
    case "unsaved":
      return { text: "Unsaved changes", tone: "text-amber-700 bg-amber-50 dark:text-amber-300 dark:bg-amber-950/50", Icon: CircleDot, spin: false };
    case "saving":
      return { text: "Saving…", tone: "text-muted-foreground bg-muted", Icon: Loader2, spin: true };
    case "invalid":
      return { text: "Not saved: fix the issue", tone: "text-destructive bg-destructive/10", Icon: AlertCircle, spin: false };
    case "error":
      return { text: "Save failed, will retry", tone: "text-destructive bg-destructive/10", Icon: AlertCircle, spin: false };
  }
}
