import { Lightbulb } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Suggestion } from "./askAi";

/** Concrete improvements computed from the document; each opens Ask AI prefilled (or the Languages panel). */
export function SuggestionsMenu({ suggestions, onPick }: { suggestions: Suggestion[]; onPick: (suggestion: Suggestion) => void }) {
  const count = suggestions.length;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={count > 0 ? `Suggestions, ${count} available` : "Suggestions"}>
          <Lightbulb className={count > 0 ? "text-amber-500" : undefined} />
          Suggestions
          {count > 0 ? (
            <span className="ml-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-amber-500 px-1 text-[10px] font-semibold text-white tabular-nums" aria-hidden="true">
              {count}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      {/* Focus goes to the Ask AI bar after a pick, not back to this button. */}
      <DropdownMenuContent align="end" className="w-72" onCloseAutoFocus={(e) => e.preventDefault()}>
        <DropdownMenuLabel className="text-xs text-muted-foreground">One click each; you review the change before it lands.</DropdownMenuLabel>
        {count === 0 ? (
          <p className="px-2 py-3 text-center text-xs text-muted-foreground">Nothing to suggest right now.</p>
        ) : (
          suggestions.map((s) => (
            <DropdownMenuItem key={s.id} onSelect={() => onPick(s)}>
              <span className="flex flex-col">
                <span>{s.title}</span>
                <span className="text-xs text-muted-foreground">{s.detail}</span>
              </span>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
