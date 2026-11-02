import { Settings2 } from "lucide-react";

/** Shown instead of the app when a production build lacks required configuration. Nothing else is rendered or loaded. */
export function MisconfiguredScreen({ missing }: { missing: string[] }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-muted/30 p-6 text-center">
      <span className="grid size-10 place-items-center rounded-xl bg-destructive/10 text-destructive">
        <Settings2 className="size-5" aria-hidden="true" />
      </span>
      <div className="max-w-md space-y-1.5">
        <h1 className="text-lg font-semibold tracking-tight">This deployment is misconfigured</h1>
        <p className="text-sm text-muted-foreground">
          The site was built without settings it needs to run safely, so it has stopped instead of guessing. Nothing you
          have saved is affected. Please tell the person who manages this site.
        </p>
        <p className="text-xs text-muted-foreground">
          Missing at build time:{" "}
          {missing.map((name, i) => (
            <span key={name}>
              {i > 0 ? ", " : ""}
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground">{name}</code>
            </span>
          ))}
        </p>
      </div>
    </div>
  );
}
