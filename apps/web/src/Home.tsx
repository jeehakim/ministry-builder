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
import { DeleteSiteDialog } from "./components/DeleteSiteDialog";
import { DashboardHeader } from "./components/DashboardHeader";
import { isNetworkError } from "./lib/errors";
import { can } from "./lib/roles";
import { useOrg } from "./orgs/OrgContext";
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

/** Where a new site goes: into the organization being viewed, or into a new organization of its own. */
type Destination = "existing" | "new";

export function Home() {
  const backend = useBackend();
  const navigate = useNavigate();
  const org = useOrg();
  const { current } = org;
  const currentId = current?.id;
  const [state, setState] = useState<State>({ kind: "loading" });
  const [open, setOpen] = useState(false);
  const [destination, setDestination] = useState<Destination>("new");
  const [orgName, setOrgName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<SiteSummary | null>(null);
  // Bumped by the banner's retry button to load the list again.
  const [attempt, setAttempt] = useState(0);
  const orgState = org.state;
  const canAddToCurrent = current !== null && can(current.role, "createSite");

  useEffect(() => {
    let cancelled = false;
    if (backend.mode === "api") {
      // Hosted sites are listed per organization, so wait for the organizations first.
      if (orgState.kind === "loading") {
        setState({ kind: "loading" });
        return;
      }
      if (orgState.kind === "error") {
        setState({ kind: "error", message: orgState.message, network: orgState.network });
        return;
      }
      if (!currentId) {
        setState({ kind: "ready", sites: [] });
        return;
      }
    }
    setState({ kind: "loading" });
    backend
      .listSites(currentId)
      .then(async (sites) => {
        if (backend.mode === "local" && sites.length === 0) {
          await backend.createSite({ orgName: "Your organization" });
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
  }, [backend, attempt, orgState, currentId]);

  function openCreate() {
    setDestination(canAddToCurrent ? "existing" : "new");
    setOrgName("");
    setCreateError(null);
    setOpen(true);
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    const name = orgName.trim();
    const intoExisting = destination === "existing" && current !== null && canAddToCurrent;
    if (!name && !intoExisting) return;
    setCreating(true);
    setCreateError(null);
    try {
      const { site } = await backend.createSite(intoExisting ? { orgId: current.id, ...(name ? { orgName: name } : {}) } : { orgName: name });
      if (!intoExisting && site.orgId) {
        // A new organization: load it into the switcher and make it current before opening its first site.
        await org.refresh();
        org.select(site.orgId);
      }
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
    <div className="min-h-dvh bg-muted/30">
      <DashboardHeader area="sites" showFundraising={Boolean(backend.fundraising)} />

      <main className="mx-auto max-w-5xl px-4 py-10">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{current ? current.name : "Your sites"}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {current ? "The sites in this organization." : "A landing page for every organization you help."}
            </p>
          </div>
          <Button onClick={openCreate} disabled={state.kind === "loading"}>
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

        {state.kind === "error" && state.network ? (
          <ApiUnreachableBanner
            onRetry={() => {
              void org.refresh();
              setAttempt((n) => n + 1);
            }}
          />
        ) : null}

        {state.kind === "error" && !state.network ? (
          <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {state.message}
          </p>
        ) : null}

        {state.kind === "ready" && state.sites.length === 0 ? (
          <Empty className="border bg-background py-16">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Globe />
              </EmptyMedia>
              <EmptyTitle>No sites yet</EmptyTitle>
              <EmptyDescription>
                {current && !canAddToCurrent
                  ? "An admin of this organization can add sites here. You can also start an organization of your own."
                  : "Name the organization and you will have a page to edit in a few seconds."}
              </EmptyDescription>
            </EmptyHeader>
            <Button onClick={openCreate}>
              <Plus />
              {current && !canAddToCurrent ? "Start a new organization" : "Create your first site"}
            </Button>
          </Empty>
        ) : null}

        {state.kind === "ready" && state.sites.length > 0 ? (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {state.sites.map((s) => (
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
                        {backend.fundraising || backend.integrations || (backend.deleteSite && can(s.role, "deleteSite")) ? (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon-sm" aria-label={`More actions for ${s.orgName}`} className="text-muted-foreground">
                                <MoreHorizontal />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {backend.fundraising ? (
                                <DropdownMenuItem asChild>
                                  <Link to="/fundraising" onClick={() => s.orgId && org.select(s.orgId)}>
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
                              {backend.deleteSite && can(s.role, "deleteSite") ? (
                                <DropdownMenuItem variant="destructive" onSelect={() => setPendingDelete(s)}>
                                  <Trash2 />
                                  Delete site
                                </DropdownMenuItem>
                              ) : null}
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
      </main>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={(e) => void handleCreate(e)}>
            <DialogHeader>
              <DialogTitle>New site</DialogTitle>
              <DialogDescription>
                {current ? "Add a site to this organization, or start a new one. You can change everything later." : "Start with the organization's name. You can change everything later."}
              </DialogDescription>
            </DialogHeader>
            {current ? (
              <fieldset className="mt-4 space-y-2">
                <legend className="sr-only">Where should the site go?</legend>
                {canAddToCurrent ? (
                  <DestinationChoice
                    name="destination"
                    value="existing"
                    checked={destination === "existing"}
                    onSelect={() => setDestination("existing")}
                    title={`Add a site to ${current.name}`}
                    hint="It joins the members, domains and email settings already here."
                  />
                ) : null}
                <DestinationChoice
                  name="destination"
                  value="new"
                  checked={destination === "new"}
                  onSelect={() => setDestination("new")}
                  title="Start a new organization"
                  hint="You become its owner. It gets its own members and settings."
                />
                {canAddToCurrent ? null : (
                  <p className="text-xs text-muted-foreground">
                    Only admins and owners can add sites to {current.name}, so you can start a new organization instead.
                  </p>
                )}
              </fieldset>
            ) : null}
            <div className="my-4 space-y-1.5">
              <Label htmlFor="org-name">{destination === "existing" ? "Site name (optional)" : "Organization name"}</Label>
              <Input
                id="org-name"
                autoFocus
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                placeholder={destination === "existing" && current ? current.name : "Grace Community Church"}
                required={destination !== "existing"}
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
    </div>
  );
}

function DestinationChoice(props: { name: string; value: string; checked: boolean; onSelect: () => void; title: string; hint: string }) {
  const { name, value, checked, onSelect, title, hint } = props;
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm has-checked:border-brand/50 has-checked:bg-brand-soft/50 has-focus-visible:ring-3 has-focus-visible:ring-ring/50">
      <input type="radio" name={name} value={value} checked={checked} onChange={onSelect} className="mt-0.5 size-4 shrink-0 accent-brand" />
      <span className="space-y-0.5">
        <span className="block font-medium">{title}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
    </label>
  );
}
