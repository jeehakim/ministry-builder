import { Link } from "react-router";
import { cn } from "@/lib/utils";

export function Brand({ compact = false, className }: { compact?: boolean; className?: string }) {
  return (
    <Link
      to="/"
      className={cn("flex items-center gap-2 rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50", className)}
      aria-label="Ministry Sites by Shofar, home"
    >
      <img src="/shofar-icon.svg" alt="" aria-hidden="true" width={28} height={28} className="size-7 shrink-0 rounded-lg shadow-sm" />
      {compact ? null : (
        <span className="leading-none">
          <span className="block text-sm font-semibold tracking-tight">Ministry Sites</span>
          <span className="block text-[11px] text-muted-foreground">build.shofar.ai</span>
        </span>
      )}
    </Link>
  );
}
