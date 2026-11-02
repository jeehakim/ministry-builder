import type { SaveState } from "../editor/useSiteDocument";

export function SaveIndicator({ state }: { state: SaveState }) {
  const { text, tone } = describe(state);
  return (
    <span role="status" aria-live="polite" className={`text-xs ${tone}`} title={state.kind === "error" ? state.message : undefined}>
      {text}
    </span>
  );
}

function describe(state: SaveState): { text: string; tone: string } {
  switch (state.kind) {
    case "saved":
      return { text: "Saved", tone: "text-emerald-700" };
    case "unsaved":
      return { text: "Unsaved changes", tone: "text-amber-700" };
    case "saving":
      return { text: "Saving...", tone: "text-slate-500" };
    case "invalid":
      return { text: "Not saved: fix the issue below", tone: "text-red-700" };
    case "error":
      return { text: `Save failed: ${state.message} Will retry on your next change.`, tone: "text-red-700" };
  }
}
