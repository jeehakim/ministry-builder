import type { FormEvent } from "react";
import { Link } from "react-router";
import type { AiDraftRequest } from "@ministry/schema";
import { ArrowLeft, Layers, PenLine, Sparkles } from "lucide-react";
import { AiUsagePill } from "../components/AiUsagePill";
import { Brand } from "../components/Brand";
import { ThemeToggle } from "../components/ThemeToggle";
import { UserMenu } from "../components/UserMenu";
import { Button } from "@/components/ui/button";
import { DRAFT_BUSY_KEY, useAi } from "./AiContext";
import { DraftFormFields, DraftProgress, useDraftForm } from "./DraftForm";

/**
 * The first thing a new site shows: tell the AI about the organization and pick from
 * three drafts before the editor appears. "Skip, build by hand" opens the editor as it is.
 */
export function StartWithAi(props: {
  orgName: string;
  onGenerate: (request: AiDraftRequest) => void;
  onSkip: () => void;
  /** Drafts from an earlier run exist and can be reviewed. */
  hasVariations: boolean;
  onReview: () => void;
}) {
  const { orgName, onGenerate, onSkip, hasVariations, onReview } = props;
  const { enabled, disabledReason, busy } = useAi();
  const working = busy[DRAFT_BUSY_KEY] === true;
  const form = useDraftForm();

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!form.valid || working || !enabled) return;
    onGenerate(form.request());
  }

  return (
    <div className="flex min-h-dvh flex-col bg-muted/30">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b bg-background px-3">
        <Button asChild variant="ghost" size="icon-sm" aria-label="Back to your sites">
          <Link to="/">
            <ArrowLeft />
          </Link>
        </Button>
        <Brand compact />
        <h1 className="min-w-0 flex-1 truncate text-sm font-medium">{orgName}</h1>
        <AiUsagePill />
        <ThemeToggle />
        <UserMenu />
      </header>

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-4 py-10">
        <section aria-labelledby="start-title" className="rounded-2xl border bg-background p-6 shadow-sm sm:p-8">
          <span className="mb-4 inline-grid size-9 place-items-center rounded-xl bg-brand-soft text-brand">
            <Sparkles className="size-4" aria-hidden="true" />
          </span>
          <h2 id="start-title" className="text-xl font-semibold tracking-tight">
            Tell us about {orgName}
          </h2>
          <p className="mt-1 mb-6 text-sm text-muted-foreground">
            A few sentences are enough. The AI writes three complete pages to choose from, and every field stays yours to edit.
          </p>

          {working ? (
            <DraftProgress variations={form.variations} />
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <DraftFormFields form={form} idPrefix="start" />
              {!enabled ? (
                <p role="status" className="rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                  {disabledReason}
                </p>
              ) : null}
              <div className="flex flex-wrap items-center gap-2 pt-2">
                <Button type="submit" disabled={!form.valid || !enabled}>
                  <Sparkles />
                  {form.count === "1" ? "Write my draft" : "Write 3 drafts"}
                </Button>
                {hasVariations ? (
                  <Button type="button" variant="outline" onClick={onReview}>
                    <Layers />
                    Review drafts
                  </Button>
                ) : null}
                <Button type="button" variant="ghost" className="ml-auto text-muted-foreground" onClick={onSkip}>
                  <PenLine />
                  Skip, build by hand
                </Button>
              </div>
            </form>
          )}
          {working ? (
            <div className="flex justify-end">
              <Button type="button" variant="ghost" className="text-muted-foreground" onClick={onSkip}>
                <PenLine />
                Skip, build by hand
              </Button>
            </div>
          ) : null}
        </section>
      </main>
    </div>
  );
}
