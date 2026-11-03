import { useEffect, useState } from "react";
import type { OrgEvent } from "@ministry/schema";
import { History } from "lucide-react";
import { useBackend } from "../backend-context";
import { ApiUnreachableBanner } from "../components/ApiUnreachableBanner";
import { isNetworkError } from "../lib/errors";
import { describeOrgEvent, eventActor } from "../lib/orgEvents";
import { formatRelativeTime } from "../lib/time";
import { Card, CardContent } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { InlineAlert, memberActionError } from "./InviteSection";

type Load = { kind: "loading" } | { kind: "error"; message: string; network: boolean } | { kind: "ready"; events: OrgEvent[] };

/** The organization's audit log, newest first: who did what, and when. */
export function ActivityPanel({ orgId }: { orgId: string }) {
  const { orgs } = useBackend();
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  // Bumped by the banner's retry button to load again.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!orgs) return;
    let cancelled = false;
    setLoad({ kind: "loading" });
    orgs
      .events(orgId)
      .then((events) => !cancelled && setLoad({ kind: "ready", events }))
      .catch((err: unknown) => {
        if (!cancelled) setLoad({ kind: "error", message: memberActionError(err), network: isNetworkError(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [orgs, orgId, attempt]);

  if (!orgs) return <p className="text-sm text-muted-foreground">Activity needs a Ministry Sites account.</p>;
  if (load.kind === "loading") return <Skeleton className="h-48 rounded-xl" />;
  if (load.kind === "error") {
    return load.network ? <ApiUnreachableBanner onRetry={() => setAttempt((n) => n + 1)} /> : <InlineAlert message={load.message} />;
  }
  if (load.events.length === 0) {
    return (
      <Empty className="border bg-background py-12">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <History />
          </EmptyMedia>
          <EmptyTitle>Nothing yet</EmptyTitle>
          <EmptyDescription>Joins, role changes, publishing and other big moments will show up here.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <Card>
      <CardContent>
        <ol aria-label="Recent activity" className="divide-y">
          {load.events.map((event) => (
            <li key={event.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2.5 first:pt-0 last:pb-0">
              <span className="min-w-0">
                <span className="block text-sm">{describeOrgEvent(event)}</span>
                <span className="block truncate text-xs text-muted-foreground">by {eventActor(event)}</span>
              </span>
              <time dateTime={event.createdAt} title={new Date(event.createdAt).toLocaleString()} className="shrink-0 text-xs text-muted-foreground">
                {formatRelativeTime(event.createdAt) || new Date(event.createdAt).toLocaleDateString()}
              </time>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
