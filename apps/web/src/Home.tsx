import { useEffect, useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router";
import { ArrowRight, Globe, HeartHandshake, Loader2, MoreHorizontal, Plus, Settings, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { SiteSummary } from "./api";
import { LOCAL_SITE_ID } from "./backend";
import { useBackend } from "./backend-context";
import { ApiUnreachableBanner } from "./components/ApiUnreachableBanner";
import { AppShell } from "./components/AppShell";
import { DeleteSiteDialog } from "./components/DeleteSiteDialog";
import { isNetworkError } from "./lib/errors";
import { useDashboardOrg } from "./lib/useDashboardOrg";
import { PublishedBadge } from "./components/PublishedBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

type State = { kind: "loading" } | { kind: "error"; message: string; network: boolean } | { kind: "ready"; sites: SiteSummary[] };

export function Home() {
  const backend = useBackend();
  const navigate = useNavigate();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [open, setOpen] = useState(false);
  const [orgName, setOrgName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<SiteSummary | null>(null);
  // Bumped by the banner's retry button to load the list again.
  const [attempt, setAttempt] = useState(0);
  const { orgs, orgId, org, setOrgId } = useDashboardOrg(state.kind === "ready" ? state.sites : null);
  // With several organizations the list shows the chosen one; with one (or none) there is nothing to filter.
  const visibleSites = state.kind === "ready" ? (orgs.length > 1 && orgId ? state.sites.filter((s) => s.orgId === orgId) : state.sites) : [];

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    backend
      .listSites()
      .then(async (sites) => {
        if (backend.mode === "local" && sites.length === 0) {
          await backend.createSite("Your organization");
          return backend.listSites();
        }
        return sites;
      })
      .then((sites) => !cancelled && setState({ kind: "ready", sites }))
      .catch((err: unknown) => {
        if (!cancelled) setState({ kind: "error", message: err instanceof Error ? err.message : "Could not load your sites.", network: isNetworkError(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [backend, attempt]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    const name = orgName.trim();
    if (!name) return;
    setCreating(true);
    setCreateError(null);
    try {
      const { site } = await backend.createSite(name);
      void navigate(`/sites/${encodeURIComponent(site.id)}`);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Could not create the site.");
      setCreating(false);
    }
  }

  if (backend.mode === "local" && state.kind === "ready" && state.sites.length > 0) {
    return <Navigate to={`/sites/${LOCAL_SITE_ID}`} replace />;
  }

  return (
    <AppShell area="sites" orgs={orgs} orgId={orgId} onOrgChange={setOrgId}>
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{org && orgs.length > 1 ? `${org.name}: sites` : "Your sites"}</h1>
            <p className="mt-1 text-sm text-muted-foreground">A landing page for every organization you help.</p>
          </div>
          <Button onClick={() => setOpen(true)} disabled={state.kind === "loading"}>
            <Plus />
            New site
          </Button>
        </div>

        {state.kind === "loading" ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-32 rounded-xl" />
            ))}
          </div>
        ) : null}

        {state.kind === "error" && state.network ? <ApiUnreachableBanner onRetry={() => setAttempt((n) => n + 1)} /> : null}

        {state.kind === "error" && !state.network ? (
          <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {state.message}
          </p>
        ) : null}

        {state.kind === "ready" && visibleSites.length === 0 ? (
          <Empty className="border bg-background py-16">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Globe />
              </EmptyMedia>
              <EmptyTitle>No sites yet</EmptyTitle>
              <EmptyDescription>Name the organization and you will have a page to edit in a few seconds.</EmptyDescription>
            </EmptyHeader>
            <Button onClick={() => setOpen(true)}>
              <Plus />
              Create your first site
            </Button>
          </Empty>
        ) : null}

        {state.kind === "ready" && visibleSites.length > 0 ? (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {visibleSites.map((s) => (
              <li key={s.id}>
                <Card className="group h-full transition-shadow hover:shadow-md">
                  <CardContent className="flex h-full flex-col justify-between gap-6">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{s.orgName}</p>
                        <p className="truncate text-xs text-muted-foreground">{s.slug}.sites.shofar.io</p>
                        {s.publishedUrl ? (
                          <div className="mt-2">
                            <PublishedBadge url={s.publishedUrl} />
                          </div>
                        ) : null}
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <span className="grid size-8 place-items-center rounded-lg bg-brand-soft text-brand">
                          <Globe className="size-4" aria-hidden="true" />
                        </span>
                        {backend.deleteSite ? (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon-sm" aria-label={`More actions for ${s.orgName}`} className="text-muted-foreground">
                                <MoreHorizontal />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {backend.fundraising ? (
                                <DropdownMenuItem asChild>
                                  <Link to={`/fundraising?org=${encodeURIComponent(s.orgId)}`}>
                                    <HeartHandshake />
                                    Fundraising
                                  </Link>
                                </DropdownMenuItem>
                              ) : null}
                              {backend.integrations ? (
                                <DropdownMenuItem asChild>
                                  <Link to={`/sites/${encodeURIComponent(s.id)}/settings`}>
                                    <Settings />
                                    Settings
                                  </Link>
                                </DropdownMenuItem>
                              ) : null}
                              <DropdownMenuItem variant="destructive" onSelect={() => setPendingDelete(s)}>
                                <Trash2 />
                                Delete site
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Updated {new Date(s.updatedAt).toLocaleDateString()}</span>
                      <Button asChild variant="ghost" size="sm" className="-mr-2">
                        <Link to={`/sites/${encodeURIComponent(s.id)}`}>
                          Open
                          <ArrowRight className="transition-transform group-hover:translate-x-0.5" />
                        </Link>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        ) : null}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={(e) => void handleCreate(e)}>
            <DialogHeader>
              <DialogTitle>New site</DialogTitle>
              <DialogDescription>Start with the organization's name. You can change everything later.</DialogDescription>
            </DialogHeader>
            <div className="my-4 space-y-1.5">
              <Label htmlFor="org-name">Organization name</Label>
              <Input
                id="org-name"
                autoFocus
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                placeholder="Grace Community Church"
                required
              />
              {createError ? (
                <p role="alert" className="text-sm text-destructive">
                  {createError}
                </p>
              ) : null}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={creating}>
                {creating ? <Loader2 className="animate-spin" /> : <Plus />}
                {creating ? "Creating…" : "Create site"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <DeleteSiteDialog
        site={pendingDelete}
        onClose={() => setPendingDelete(null)}
        onDeleted={(id) => {
          setState((current) => (current.kind === "ready" ? { kind: "ready", sites: current.sites.filter((x) => x.id !== id) } : current));
          setPendingDelete(null);
        }}
      />
    </AppShell>
  );
}
