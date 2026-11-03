import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { AlertCircle, ArrowRight, HeartHandshake, Loader2, Plus } from "lucide-react";
import type { OrgCampaign, OrgCampaignList, SiteSummary } from "../api";
import { useBackend } from "../backend-context";
import { ApiUnreachableBanner } from "../components/ApiUnreachableBanner";
import { DashboardHeader } from "../components/DashboardHeader";
import { isNetworkError } from "../lib/errors";
import { progressText, publishState, STATUS_LABELS } from "../lib/fundraising";
import { can } from "../lib/roles";
import { useOrg } from "../orgs/OrgContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

type Sites = { kind: "loading" } | { kind: "error"; message: string; network: boolean } | { kind: "ready"; sites: SiteSummary[] };
type Campaigns = { kind: "idle" } | { kind: "loading" } | { kind: "error"; message: string; network: boolean } | { kind: "ready"; data: OrgCampaignList };

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

export function campaignPath(siteId: string, campaignId: string): string {
  return `/sites/${encodeURIComponent(siteId)}/fundraising/${encodeURIComponent(campaignId)}`;
}

/** The Fundraising area of the dashboard: every campaign of the organization, across its sites. */
export function FundraisingPage() {
  const backend = useBackend();
  const navigate = useNavigate();
  const [sites, setSites] = useState<Sites>({ kind: "loading" });
  const [campaigns, setCampaigns] = useState<Campaigns>({ kind: "idle" });
  const [attempt, setAttempt] = useState(0);
  const { state: orgState, current } = useOrg();
  const orgId = current?.id ?? null;
  const canEdit = current !== null && can(current.role, "edit");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (orgState.kind === "loading") {
      setSites({ kind: "loading" });
      return;
    }
    if (orgState.kind === "error") {
      setSites({ kind: "error", message: orgState.message, network: orgState.network });
      return;
    }
    if (!orgId) {
      setSites({ kind: "ready", sites: [] });
      return;
    }
    setSites({ kind: "loading" });
    backend
      .listSites(orgId)
      .then((list) => !cancelled && setSites({ kind: "ready", sites: list }))
      .catch((err: unknown) => {
        if (!cancelled) setSites({ kind: "error", message: errorText(err, "Could not load your sites."), network: isNetworkError(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [backend, attempt, orgState, orgId]);

  useEffect(() => {
    const fundraising = backend.fundraising;
    if (!fundraising || !orgId) return;
    let cancelled = false;
    setCampaigns({ kind: "loading" });
    fundraising
      .listForOrg(orgId)
      .then((data) => !cancelled && setCampaigns({ kind: "ready", data }))
      .catch((err: unknown) => {
        if (!cancelled) setCampaigns({ kind: "error", message: errorText(err, "Could not load campaigns."), network: isNetworkError(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [backend, orgId, attempt]);

  const orgSites = sites.kind === "ready" ? sites.sites : [];
  const siteById = new Map(orgSites.map((s) => [s.id, s]));

  return (
    <div className="min-h-dvh bg-muted/30">
      <DashboardHeader area="fundraising" showFundraising={Boolean(backend.fundraising)} />
      <main className="mx-auto max-w-5xl px-4 py-10">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{current ? `${current.name}: fundraising` : "Fundraising"}</h1>
          <p className="mt-1 text-sm text-muted-foreground">Campaigns with a story, a goal and a progress bar, published on your site. Giving goes through the processor you already use.</p>
        </div>
        {backend.fundraising && orgSites.length > 0 && canEdit ? (
          <Button onClick={() => setCreating(true)}>
            <Plus />
            New campaign
          </Button>
        ) : null}
      </div>

      {!backend.fundraising ? (
        <Empty className="border bg-background py-16">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HeartHandshake />
            </EmptyMedia>
            <EmptyTitle>Fundraising needs a Ministry Sites account</EmptyTitle>
            <EmptyDescription>Local mode keeps your site in this browser only. Campaigns and gifts live on the server, next to your published site.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : sites.kind === "loading" || campaigns.kind === "loading" || campaigns.kind === "idle" ? (
        sites.kind === "error" ? null : (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-xl" />
            ))}
          </div>
        )
      ) : null}

      {sites.kind === "error" || campaigns.kind === "error" ? (
        (sites.kind === "error" ? sites.network : campaigns.kind === "error" && campaigns.network) ? (
          <ApiUnreachableBanner onRetry={() => setAttempt((n) => n + 1)} />
        ) : (
          <p role="alert" className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            <AlertCircle className="size-4" aria-hidden="true" />
            {sites.kind === "error" ? sites.message : campaigns.kind === "error" ? campaigns.message : ""}
          </p>
        )
      ) : null}

      {backend.fundraising && sites.kind === "ready" && orgSites.length === 0 ? (
        <Empty className="border bg-background py-16">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HeartHandshake />
            </EmptyMedia>
            <EmptyTitle>Create a site first</EmptyTitle>
            <EmptyDescription>Campaigns are published as pages of a site. Make one under Sites, then come back here.</EmptyDescription>
          </EmptyHeader>
          <Button asChild variant="outline">
            <Link to="/">Go to Sites</Link>
          </Button>
        </Empty>
      ) : null}

      {campaigns.kind === "ready" && orgSites.length > 0 && campaigns.data.campaigns.length === 0 ? (
        <Empty className="border bg-background py-16">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HeartHandshake />
            </EmptyMedia>
            <EmptyTitle>No campaigns yet</EmptyTitle>
            <EmptyDescription>
              {canEdit
                ? "Give it a title and a goal, let AI draft the story, and share one link. You can record gifts as they come in."
                : "An editor of this organization can start one. You will see its progress here."}
            </EmptyDescription>
          </EmptyHeader>
          {canEdit ? (
            <Button onClick={() => setCreating(true)}>
              <Plus />
              Create your first campaign
            </Button>
          ) : null}
        </Empty>
      ) : null}

      {campaigns.kind === "ready" && campaigns.data.campaigns.length > 0 ? (
        <ul className="space-y-3">
          {campaigns.data.campaigns.map((c) => (
            <CampaignRow key={c.id} campaign={c} site={siteById.get(c.siteId)} />
          ))}
        </ul>
      ) : null}

      <NewCampaignDialog
        open={creating}
        sites={orgSites}
        onOpenChange={setCreating}
        onCreated={(siteId, campaignId) => void navigate(campaignPath(siteId, campaignId))}
      />
      </main>
    </div>
  );
}

function CampaignRow({ campaign: c, site }: { campaign: OrgCampaign; site: SiteSummary | undefined }) {
  const state = publishState(c.status, site?.publishedAt ?? null, c.updatedAt);
  return (
    <li>
      <Link to={campaignPath(c.siteId, c.id)} className="block rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
        <Card className="transition-shadow hover:shadow-md">
          <CardContent className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-center">
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate font-medium">{c.title}</span>
                <Badge variant={c.status === "active" ? "default" : c.status === "closed" ? "outline" : "secondary"}>{STATUS_LABELS[c.status]}</Badge>
                {c.status === "active" ? <Badge variant={state.label === "Live" ? "secondary" : "outline"}>{state.label}</Badge> : null}
                <span className="text-xs text-muted-foreground">{site ? `${site.slug}.sites.shofar.io` : c.siteSlug}</span>
              </div>
              {c.totals.goalAmount > 0 ? (
                <div className="h-2 max-w-md overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={c.totals.percent}>
                  <div className="h-full rounded-full bg-brand" style={{ width: `${c.totals.percent}%` }} />
                </div>
              ) : null}
              <p className="text-sm text-muted-foreground">
                {progressText(c.totals)} · {c.totals.giftCount} {c.totals.giftCount === 1 ? "gift" : "gifts"}
                {c.deadline ? ` · ends ${c.deadline}` : ""}
              </p>
            </div>
            <span className="flex items-center gap-1 text-sm font-medium text-brand">
              Open
              <ArrowRight className="size-4" aria-hidden="true" />
            </span>
          </CardContent>
        </Card>
      </Link>
    </li>
  );
}

function NewCampaignDialog(props: { open: boolean; sites: SiteSummary[]; onOpenChange: (open: boolean) => void; onCreated: (siteId: string, campaignId: string) => void }) {
  const { open, sites, onOpenChange, onCreated } = props;
  const backend = useBackend();
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [siteId, setSiteId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editable = sites.filter((s) => can(s.role, "edit"));
  const chosenSite = editable.find((s) => s.id === siteId) ?? editable[0];

  async function submit(e: FormEvent) {
    e.preventDefault();
    const fundraising = backend.fundraising;
    if (!fundraising || !chosenSite) return;
    const name = title.trim();
    if (!name) return;
    const goalCents = goal.trim() === "" ? 0 : Math.round(Number(goal.replace(/[^0-9.]/g, "")) * 100);
    if (!Number.isFinite(goalCents) || goalCents < 0) {
      setError("The goal must be an amount such as 5000.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const campaign = await fundraising.create(chosenSite.id, {
        title: name,
        summary: "",
        story: "",
        goalAmount: goalCents,
        currency: "USD",
        suggestedAmounts: [],
        giveUrl: "",
        giveLabel: "",
        donorWallEnabled: false,
        thankYouMessage: "",
        status: "draft",
        translations: {},
      });
      setTitle("");
      setGoal("");
      onOpenChange(false);
      onCreated(chosenSite.id, campaign.id);
    } catch (err) {
      setError(errorText(err, "Could not create the campaign."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={(e) => void submit(e)}>
          <DialogHeader>
            <DialogTitle>New campaign</DialogTitle>
            <DialogDescription>Start with a title. The story, goal and giving link come next, and nothing is public until you set it active and publish.</DialogDescription>
          </DialogHeader>
          <div className="my-4 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="campaign-title">Title</Label>
              <Input id="campaign-title" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Winter shelter 2026" required maxLength={120} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="campaign-goal">Goal (USD, optional)</Label>
              <Input id="campaign-goal" inputMode="decimal" value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="5000" />
            </div>
            {editable.length > 1 ? (
              <div className="space-y-1.5">
                <Label htmlFor="campaign-site">Site</Label>
                <Select value={chosenSite?.id} onValueChange={setSiteId}>
                  <SelectTrigger id="campaign-site" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {editable.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.orgName} ({s.slug})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !chosenSite}>
              {busy ? <Loader2 className="animate-spin" /> : <Plus />}
              {busy ? "Creating…" : "Create campaign"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
