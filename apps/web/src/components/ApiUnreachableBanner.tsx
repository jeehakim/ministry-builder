import { RotateCw, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Shown when a request failed before reaching the server: offline, a network fault, a timeout, or the API being down. */
export function ApiUnreachableBanner({ onRetry, className }: { onRetry: () => void; className?: string }) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-200",
        className,
      )}
    >
      <WifiOff className="size-4 shrink-0" aria-hidden="true" />
      <p className="min-w-0 flex-1">Can't reach the server. Check your connection, then try again.</p>
      <Button type="button" variant="outline" size="sm" onClick={onRetry}>
        <RotateCw />
        Try again
      </Button>
    </div>
  );
}
