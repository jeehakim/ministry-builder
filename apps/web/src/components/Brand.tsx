import { Link } from "react-router";
import { HeartHandshake } from "lucide-react";
import { cn } from "@/lib/utils";

export function Brand({ compact = false, className }: { compact?: boolean; className?: string }) {
  return (
    <Link
      to="/"
      className={cn("flex items-center gap-2 rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50", className)}
      aria-label="Ministry Sites home"
    >
      <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-linear-to-br from-brand to-sky-400 text-white shadow-sm">
        <HeartHandshake className="size-4" aria-hidden="true" />
      </span>
      {compact ? null : (
        <span className="leading-none">
          <span className="block text-sm font-semibold tracking-tight">Ministry Sites</span>
          <span className="block text-[11px] text-muted-foreground">build.shofar.io</span>
        </span>
      )}
    </Link>
  );
}
