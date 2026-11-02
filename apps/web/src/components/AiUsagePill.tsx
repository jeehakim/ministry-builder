import { Sparkles } from "lucide-react";
import { useAi } from "../editor/AiContext";
import { formatClockTime } from "../lib/time";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** "AI 3/30" with the reset time on hover, or "AI off" with the reason AI is unavailable. */
export function AiUsagePill() {
  const { enabled, disabledReason, usage } = useAi();

  let text: string;
  let tip: string;
  if (!enabled) {
    text = "AI off";
    tip = disabledReason ?? "AI is unavailable.";
  } else if (usage.kind === "ready") {
    text = `AI ${usage.usage.used}/${usage.usage.limit}`;
    const when = formatClockTime(usage.usage.resetsAt);
    tip = when ? `AI actions used today, resets at ${when}` : "AI actions used today";
    const shared = usage.usage.organization;
    if (shared) tip += `. Your organization has used ${shared.used} of ${shared.limit} today.`;
  } else if (usage.kind === "error") {
    text = "AI ?";
    tip = "Could not load today's AI usage.";
  } else {
    text = "AI …";
    tip = "Loading today's AI usage.";
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
            enabled ? "bg-brand-soft text-brand" : "bg-muted text-muted-foreground",
          )}
        >
          <Sparkles className="size-3" aria-hidden="true" />
          <span>{text}</span>
          <span className="sr-only">. {tip}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom">{tip}</TooltipContent>
    </Tooltip>
  );
}
