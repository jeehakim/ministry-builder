import { Component, useEffect, useState, type ReactNode } from "react";
import { Check, Copy, RotateCw, TriangleAlert } from "lucide-react";
import { formatErrorReport, makeErrorId } from "../lib/errors";
import { Button } from "@/components/ui/button";

function randomByte(): number {
  return crypto.getRandomValues(new Uint8Array(1))[0] ?? 0;
}

interface State {
  report: string | null;
  id: string | null;
}

/**
 * Catches render errors anywhere below it and shows a plain recovery page instead of a blank screen.
 * It sits above the router and the providers, so the fallback depends on none of them. Users see a
 * short id and can copy a report; the stack trace is never shown or copied.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { report: null, id: null };

  static getDerivedStateFromError(error: unknown): State {
    const id = makeErrorId(randomByte);
    const report = formatErrorReport({
      id,
      time: new Date(),
      path: window.location.pathname,
      error,
      userAgent: navigator.userAgent,
    });
    return { id, report };
  }

  render(): ReactNode {
    if (this.state.report === null || this.state.id === null) return this.props.children;
    return <CrashPage id={this.state.id} report={this.state.report} />;
  }
}

type CopyState = "idle" | "copied" | "failed";

export function CrashPage({ id, report }: { id: string; report: string }) {
  const [copy, setCopy] = useState<CopyState>("idle");

  useEffect(() => {
    if (copy === "idle") return;
    const timer = setTimeout(() => setCopy("idle"), 3000);
    return () => clearTimeout(timer);
  }, [copy]);

  async function copyDetails() {
    try {
      await navigator.clipboard.writeText(report);
      setCopy("copied");
    } catch {
      setCopy("failed");
    }
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-5 bg-muted/30 p-6 text-center">
      <span className="grid size-10 place-items-center rounded-xl bg-destructive/10 text-destructive">
        <TriangleAlert className="size-5" aria-hidden="true" />
      </span>
      <div className="max-w-sm space-y-1.5">
        <h1 className="text-lg font-semibold tracking-tight">Something went wrong</h1>
        <p className="text-sm text-muted-foreground">
          The page hit an unexpected problem. Reloading usually fixes it, and edits that were already saved are safe.
        </p>
        <p className="text-xs text-muted-foreground">
          Error ID <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground">{id}</code>
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button onClick={() => window.location.reload()}>
          <RotateCw />
          Reload
        </Button>
        <Button variant="outline" onClick={() => void copyDetails()}>
          {copy === "copied" ? <Check /> : <Copy />}
          {copy === "copied" ? "Copied" : "Copy details"}
        </Button>
      </div>
      <p role="status" className="min-h-4 text-xs text-muted-foreground">
        {copy === "failed" ? `Could not copy. Quote the error ID ${id} if you contact support.` : ""}
      </p>
    </div>
  );
}
