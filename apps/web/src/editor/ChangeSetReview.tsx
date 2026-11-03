import type { SiteDocument } from "@ministry/schema";
import { Check, Loader2, RefreshCw, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { changeLines, changeTitle, isOptionSet, sectionLabel, sectionLines, scopeLabel, type ChangeLine, type Proposal } from "./askAi";
import { SECTION_LABELS } from "./fields";

function Lines({ lines }: { lines: ChangeLine[] }) {
  if (lines.length === 0) return <p className="text-xs text-muted-foreground">No text changes.</p>;
  return (
    <dl className="space-y-2">
      {lines.map((line) => (
        <div key={line.field} className="space-y-0.5">
          <dt className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{line.field}</dt>
          {line.before ? <dd className="text-xs text-muted-foreground line-through decoration-destructive/50 whitespace-pre-wrap">{line.before}</dd> : null}
          <dd className="text-sm whitespace-pre-wrap">{line.after || <span className="text-muted-foreground italic">(empty)</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The proposed change set: each change with its before and after text, over the sidebar.
 * The preview shows the proposed page with changed sections outlined. Nothing is applied
 * until Apply (or Use this on an option) is clicked.
 */
export function ChangeSetReview(props: {
  doc: SiteDocument;
  proposal: Proposal;
  /** For an option set: the option shown in the preview. */
  chosen: number;
  onChosen: (index: number) => void;
  /** Try again is running. */
  busy: boolean;
  /** Applies the proposal; for an option set, the option at `index`. */
  onApply: (index: number) => void;
  onTryAgain: () => void;
  onDiscard: () => void;
}) {
  const { doc, proposal, chosen, onChosen, busy, onApply, onTryAgain, onDiscard } = props;
  const options = proposal.kind === "edit" && isOptionSet(proposal.changes);
  const scope = proposal.kind === "edit" ? scopeLabel(proposal.request.scope, doc) : "New section";
  const title = options ? `${proposal.changes.length} options for ${scope}` : proposal.kind === "add" ? "Proposed new section" : "Proposed changes";

  return (
    <section aria-label={title} className="absolute inset-0 z-20 flex flex-col bg-sidebar">
      <header className="flex items-start gap-2 border-b px-3 py-2.5">
        <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md bg-brand-soft text-brand">
          <Sparkles className="size-3.5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-medium">{title}</h2>
          <p className="truncate text-[11px] text-muted-foreground" title={proposal.request.instruction}>
            “{proposal.request.instruction}”{proposal.model ? ` · ${proposal.model}` : ""}
          </p>
        </div>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Discard proposed changes" onClick={onDiscard}>
          <X />
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {proposal.kind === "add" ? (
          <article className="rounded-xl border bg-card p-3 shadow-xs">
            <h3 className="text-sm font-medium">{sectionLabel(proposal.section)}</h3>
            <p className="mb-2 text-[11px] text-muted-foreground">
              {SECTION_LABELS[proposal.section.type]} section, inserted {proposal.request.afterSectionId ? `after “${scopeLabel({ kind: "section", id: proposal.request.afterSectionId }, doc)}”` : "at the end"}
            </p>
            <Lines lines={sectionLines(proposal.section)} />
          </article>
        ) : options ? (
          <ul className="space-y-2" aria-label="Options">
            {proposal.changes.map((change, index) => (
              <li key={index}>
                <article
                  aria-label={change.label ?? `Option ${index + 1}`}
                  aria-current={index === chosen ? "true" : undefined}
                  className={cn(
                    "cursor-pointer rounded-xl border bg-card p-3 shadow-xs transition-colors",
                    index === chosen ? "border-brand/50 ring-3 ring-brand/15" : "hover:border-foreground/20",
                  )}
                  onClick={() => onChosen(index)}
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <h3 className="text-sm font-medium">{change.label ?? `Option ${index + 1}`}</h3>
                    <Button
                      type="button"
                      size="xs"
                      variant={index === chosen ? "default" : "outline"}
                      onClick={(e) => {
                        e.stopPropagation();
                        onApply(index);
                      }}
                    >
                      <Check />
                      Use this
                    </Button>
                  </div>
                  <Lines lines={changeLines(change)} />
                </article>
              </li>
            ))}
          </ul>
        ) : (
          <ul className="space-y-2" aria-label="Changes">
            {proposal.changes.map((change) => (
              <li key={change.target}>
                <article className="rounded-xl border bg-card p-3 shadow-xs">
                  <h3 className="mb-2 text-sm font-medium">{changeTitle(change, doc)}</h3>
                  <Lines lines={changeLines(change)} />
                </article>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 px-1 text-[11px] text-muted-foreground">
          {options ? "Click an option to see it in the preview. The rest of the page stays as it is." : "The preview shows the page with these changes. Applied changes are one Undo away."}
        </p>
      </div>

      <footer className="flex items-center gap-2 border-t px-3 py-2">
        {!options ? (
          <Button type="button" size="sm" onClick={() => onApply(chosen)} disabled={busy}>
            <Check />
            Apply
          </Button>
        ) : null}
        <Button type="button" size="sm" variant="outline" onClick={onTryAgain} disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          Try again
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDiscard} disabled={busy} className="ml-auto">
          Discard
        </Button>
      </footer>
    </section>
  );
}
