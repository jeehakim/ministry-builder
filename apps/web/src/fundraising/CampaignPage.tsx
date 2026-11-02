import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import {
  CampaignInput,
  languageName,
  siteLanguages,
  type Campaign,
  type CampaignStatus,
  type CampaignTotals,
  type CampaignWithTotals,
  type Gift,
  type SiteDocument,
} from "@ministry/schema";
import { AlertCircle, ArrowLeft, ExternalLink, Loader2, Rocket, Save, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { SiteInfo } from "../api";
import { useBackend } from "../backend-context";
import { ApiUnreachableBanner } from "../components/ApiUnreachableBanner";
import { Brand } from "../components/Brand";
import { HelpMenu } from "../components/HelpMenu";
import { ImageField } from "../components/ImageField";
import { TextField } from "../components/Field";
import { ThemeToggle } from "../components/ThemeToggle";
import { UserMenu } from "../components/UserMenu";
import { AiProvider, CAMPAIGN_STORY_BUSY_KEY, THANK_YOU_BUSY_KEY, useAi } from "../editor/AiContext";
import { SiteIdProvider } from "../editor/EditorContext";
import { isNetworkError } from "../lib/errors";
import { amountsToText, campaignPublicUrl, centsToText, progressText, publishState, STATUS_HINTS, STATUS_LABELS, textToAmounts, textToGoal } from "../lib/fundraising";
import { useBeforeUnloadGuard } from "../lib/useBeforeUnloadGuard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { GiftsPanel } from "./GiftsPanel";

type Load =
  | { kind: "loading" }
  | { kind: "error"; message: string; network: boolean }
  | { kind: "ready"; site: SiteInfo; doc: SiteDocument; campaign: CampaignWithTotals; gifts: Gift[] };

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong.";
}

/** The editable part of a campaign, as the PUT body wants it. */
function toInput(campaign: Campaign): CampaignInput {
  const { id: _id, siteId: _s, orgId: _o, createdAt: _c, updatedAt: _u, ...rest } = campaign;
  return rest;
}

export function CampaignPage() {
  const { id, cid } = useParams();
  const backend = useBackend();
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const fundraising = backend.fundraising;
    if (!id || !cid || !fundraising) return;
    let cancelled = false;
    setLoad({ kind: "loading" });
    Promise.all([backend.loadSite(id), fundraising.get(id, cid), fundraising.listGifts(id, cid)])
      .then(([loaded, campaign, gifts]) => {
        if (!cancelled) setLoad({ kind: "ready", site: loaded.site, doc: loaded.document, campaign: { ...campaign, totals: gifts.totals }, gifts: gifts.gifts });
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoad({ kind: "error", message: errorText(err), network: isNetworkError(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [backend, id, cid, attempt]);

  const unavailable = !id || !cid || !backend.fundraising;

  return (
    <div className="min-h-dvh bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <Brand />
          <div className="flex items-center gap-1">
            <HelpMenu />
            <ThemeToggle />
            <UserMenu />
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-4 py-8">
        {unavailable ? (
          <p className="text-sm text-muted-foreground">Fundraising needs a Ministry Sites account.</p>
        ) : load.kind === "loading" ? (
          <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
            <Skeleton className="h-96 rounded-xl" />
            <Skeleton className="h-64 rounded-xl" />
          </div>
        ) : load.kind === "error" ? (
          <div className="mx-auto max-w-md space-y-3 text-center">
            {load.network ? (
              <ApiUnreachableBanner onRetry={() => setAttempt((n) => n + 1)} />
            ) : (
              <p role="alert" className="flex items-center justify-center gap-2 text-sm">
                <AlertCircle className="size-4 text-destructive" aria-hidden="true" />
                {load.message}
              </p>
            )}
            <Button asChild variant="outline" size="sm">
              <Link to="/fundraising">
                <ArrowLeft />
                Back to fundraising
              </Link>
            </Button>
          </div>
        ) : (
          <SiteIdProvider value={id}>
            <AiProvider>
              <CampaignEditor key={cid} site={load.site} doc={load.doc} initial={load.campaign} initialGifts={load.gifts} />
            </AiProvider>
          </SiteIdProvider>
        )}
      </div>
    </div>
  );
}

function CampaignEditor({ site, doc, initial, initialGifts }: { site: SiteInfo; doc: SiteDocument; initial: CampaignWithTotals; initialGifts: Gift[] }) {
  const backend = useBackend();
  const fundraising = backend.fundraising!;
  const navigate = useNavigate();
  const ai = useAi();
  const [saved, setSaved] = useState<Campaign>(initial);
  const [draft, setDraft] = useState<CampaignInput>(() => toInput(initial));
  const [goalText, setGoalText] = useState(() => centsToText(initial.goalAmount));
  const [amountsText, setAmountsText] = useState(() => amountsToText(initial.suggestedAmounts));
  const [totals, setTotals] = useState<CampaignTotals>(initial.totals);
  const [gifts, setGifts] = useState<Gift[]>(initialGifts);
  const [lang, setLang] = useState(doc.meta.language);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [storyOpen, setStoryOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const primary = doc.meta.language;
  const languages = useMemo(() => siteLanguages(doc), [doc]);
  const translating = lang !== primary;
  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(toInput(saved)) || goalText !== centsToText(saved.goalAmount) || amountsText !== amountsToText(saved.suggestedAmounts),
    [draft, saved, goalText, amountsText],
  );
  useBeforeUnloadGuard(dirty);

  const overlay = draft.translations[lang] ?? {};
  /** The text fields as seen in the editing language: the overlay's value, else the primary text. */
  const text = (key: "title" | "summary" | "story" | "thankYouMessage"): string => (translating ? (overlay[key] ?? draft[key]) : draft[key]);
  const setText = (key: "title" | "summary" | "story" | "thankYouMessage", value: string) => {
    setDraft((d) => {
      if (!translating) return { ...d, [key]: value };
      const next = { ...(d.translations[lang] ?? {}) };
      if (value === d[key] || value === "") delete next[key];
      else next[key] = value;
      const translations = { ...d.translations };
      if (Object.keys(next).length) translations[lang] = next;
      else delete translations[lang];
      return { ...d, translations };
    });
  };

  const state = publishState(saved.status, site.publishedAt, saved.updatedAt);
  const publicUrl = saved.status === "active" ? campaignPublicUrl(site.publishedUrl, saved.slug) : null;
  const editorPath = `/sites/${encodeURIComponent(site.id)}`;

  async function save(): Promise<boolean> {
    const goal = textToGoal(goalText);
    const amounts = textToAmounts(amountsText);
    const parsed = CampaignInput.safeParse({ ...draft, goalAmount: goal.goal, suggestedAmounts: amounts.amounts });
    const issue = goal.error ?? amounts.error ?? (parsed.success ? null : parsed.error.issues[0]?.message ?? "Check the fields");
    if (issue || !parsed.success) {
      setProblem(issue);
      return false;
    }
    setSaving(true);
    setProblem(null);
    try {
      const next = await fundraising.update(site.id, saved.id, parsed.data);
      setSaved(next);
      setDraft(toInput(next));
      setGoalText(centsToText(next.goalAmount));
      setAmountsText(amountsToText(next.suggestedAmounts));
      setTotals(next.totals);
      toast.success("Campaign saved", { description: next.status === "active" ? "Publish the site to put the changes online." : undefined });
      return true;
    } catch (err) {
      setProblem(errorText(err));
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    try {
      await fundraising.remove(site.id, saved.id);
      toast.success(`Deleted ${saved.title}`, { description: "Its page comes down on the next publish." });
      void navigate(`/fundraising?org=${encodeURIComponent(saved.orgId)}`, { replace: true });
    } catch (err) {
      toast.error("Could not delete the campaign", { description: errorText(err) });
      setConfirmDelete(false);
    }
  }

  async function writeThankYou() {
    const message = await ai.runThankYou(saved.id, { notes: "", language: lang });
    if (message !== null) setText("thankYouMessage", message);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link to={`/fundraising?org=${encodeURIComponent(saved.orgId)}`}>
            <ArrowLeft />
            Fundraising
          </Link>
        </Button>
        <h1 className="min-w-0 flex-1 truncate text-xl font-semibold tracking-tight">{saved.title}</h1>
        <Badge variant={saved.status === "active" ? "default" : saved.status === "closed" ? "outline" : "secondary"}>{STATUS_LABELS[saved.status]}</Badge>
        {dirty ? <span className="text-xs text-muted-foreground">Unsaved changes</span> : null}
        <Button size="sm" disabled={saving || !dirty} onClick={() => void save()}>
          {saving ? <Loader2 className="animate-spin" /> : <Save />}
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>

      {problem ? (
        <p role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {problem}
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px] lg:items-start">
        <div className="space-y-6">
          <Card>
            <CardHeader className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>Story</CardTitle>
                <CardDescription>What the campaign is for and who it helps. The summary goes on the card in your Give section.</CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {languages.length > 1 ? (
                  <Select value={lang} onValueChange={setLang}>
                    <SelectTrigger size="sm" aria-label="Editing language">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {languages.map((code) => (
                        <SelectItem key={code} value={code}>
                          {languageName(code)}
                          {code === primary ? " (main)" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-disabled={!ai.enabled || undefined}
                  className={cn(!ai.enabled && "cursor-not-allowed opacity-50")}
                  title={ai.enabled ? "Draft the title, summary and story from a few notes" : (ai.disabledReason ?? undefined)}
                  onClick={() => {
                    if (ai.enabled) setStoryOpen(true);
                  }}
                >
                  {ai.busy[CAMPAIGN_STORY_BUSY_KEY] ? <Loader2 className="animate-spin" /> : <Sparkles />}
                  Draft with AI
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {translating ? (
                <p className="rounded-lg border border-brand/30 bg-brand-soft/50 px-3 py-2 text-xs">
                  Editing the {languageName(lang)} text. Leave a field empty to show the {languageName(primary)} version. Goal, link and images are shared by every language.
                </p>
              ) : null}
              <TextField label="Title" value={text("title")} assist={{ context: "fundraising campaign title" }} onChange={(v) => setText("title", v)} />
              <TextField
                label="Summary (one sentence for the card)"
                value={text("summary")}
                assist={{ context: "fundraising campaign summary" }}
                onChange={(v) => setText("summary", v)}
              />
              <TextField
                label="Story"
                multiline
                value={text("story")}
                placeholder="Separate paragraphs with a blank line."
                assist={{ context: "fundraising campaign story" }}
                onChange={(v) => setText("story", v)}
              />
              <ImageField label="Cover image" value={draft.coverImage} locked={translating} onChange={(coverImage) => setDraft((d) => ({ ...d, coverImage }))} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Goal and giving</CardTitle>
              <CardDescription>The platform never takes payments. Buttons on the page open your processor's form with the campaign (and amount) in the link.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="goal">Goal ({draft.currency})</Label>
                <Input id="goal" inputMode="decimal" value={goalText} disabled={translating} placeholder="5000" onChange={(e) => setGoalText(e.target.value)} />
                <p className="text-xs text-muted-foreground">Leave empty for no goal: the page shows the total raised without a bar.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="deadline">Deadline (optional)</Label>
                <Input id="deadline" type="date" value={draft.deadline ?? ""} disabled={translating} onChange={(e) => setDraft((d) => ({ ...d, deadline: e.target.value || undefined }))} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="give-url">Giving link (https)</Label>
                <Input
                  id="give-url"
                  type="url"
                  value={draft.giveUrl}
                  disabled={translating}
                  placeholder="https://www.zeffy.com/donation-form/…"
                  onChange={(e) => setDraft((d) => ({ ...d, giveUrl: e.target.value.trim() }))}
                />
                <p className="text-xs text-muted-foreground">Your Zeffy, Givebutter, PayPal or Tithe.ly form. Make one form per campaign so gifts are attributed on their side.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="give-label">Button label</Label>
                <Input id="give-label" value={draft.giveLabel} maxLength={60} placeholder="Give now" onChange={(e) => setDraft((d) => ({ ...d, giveLabel: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="amounts">Suggested amounts</Label>
                <Input id="amounts" value={amountsText} disabled={translating} placeholder="25, 50, 100" onChange={(e) => setAmountsText(e.target.value)} />
                <p className="text-xs text-muted-foreground">Up to six, separated by commas.</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Donors and thanks</CardTitle>
              <CardDescription>Who appears on the page, and what donors hear from you.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <label className="flex items-start gap-3 rounded-lg border bg-muted/30 p-2.5 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 accent-brand"
                  checked={draft.donorWallEnabled}
                  disabled={translating}
                  onChange={(e) => setDraft((d) => ({ ...d, donorWallEnabled: e.target.checked }))}
                />
                <span>
                  <span className="block font-medium">Show a donor wall</span>
                  <span className="block text-xs text-muted-foreground">Lists donors who agreed to be named, as first name and initial. Private gifts never appear.</span>
                </span>
              </label>
              <div className="space-y-1.5">
                <div className="flex min-h-6 items-center justify-between gap-2">
                  <Label htmlFor="thank-you" className="text-xs text-muted-foreground">
                    Thank-you email
                  </Label>
                  {ai.ai ? (
                    <Button type="button" variant="ghost" size="xs" disabled={!ai.enabled || ai.busy[THANK_YOU_BUSY_KEY] === true} title={ai.enabled ? "Write it from the story" : (ai.disabledReason ?? undefined)} onClick={() => void writeThankYou()}>
                      {ai.busy[THANK_YOU_BUSY_KEY] ? <Loader2 className="animate-spin" /> : <Sparkles />}
                      Write with AI
                    </Button>
                  ) : null}
                </div>
                <Textarea
                  id="thank-you"
                  rows={6}
                  value={text("thankYouMessage")}
                  maxLength={2000}
                  placeholder={"Dear {{name}},\n\nThank you for your gift…"}
                  onChange={(e) => setText("thankYouMessage", e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Sent to the donor's address when you record a gift by hand, through your email sender. {"{{name}}"} becomes the donor's name. Empty uses a plain default.
                </p>
              </div>
            </CardContent>
          </Card>

          <GiftsPanel
            fundraising={fundraising}
            siteId={site.id}
            campaignId={saved.id}
            currency={saved.currency}
            gifts={gifts}
            totals={totals}
            onChange={(nextGifts, nextTotals) => {
              setGifts(nextGifts);
              setTotals(nextTotals);
            }}
          />
        </div>

        <aside className="space-y-4 lg:sticky lg:top-6">
          <Card>
            <CardHeader>
              <CardTitle>Progress</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {totals.goalAmount > 0 ? (
                <div className="h-2.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={totals.percent}>
                  <div className="h-full rounded-full bg-brand" style={{ width: `${totals.percent}%` }} />
                </div>
              ) : null}
              <p className="text-sm">{progressText(totals)}</p>
              <p className="text-xs text-muted-foreground">
                {totals.giftCount} {totals.giftCount === 1 ? "gift" : "gifts"} recorded. The published page shows these numbers as of the last publish.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Publishing</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="status">Status</Label>
                <Select value={draft.status} onValueChange={(v) => setDraft((d) => ({ ...d, status: v as CampaignStatus }))}>
                  <SelectTrigger id="status" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(STATUS_LABELS) as CampaignStatus[]).map((s) => (
                      <SelectItem key={s} value={s}>
                        {STATUS_LABELS[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{STATUS_HINTS[draft.status]}</p>
              </div>
              <div className="rounded-lg border bg-muted/30 p-2.5 text-sm">
                <p className="flex items-center gap-2 font-medium">
                  <span className={cn("size-2 rounded-full", state.label === "Live" ? "bg-emerald-500" : "bg-muted-foreground/50")} aria-hidden="true" />
                  {state.label}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{state.detail}</p>
              </div>
              {publicUrl ? (
                <a href={publicUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-sm text-brand underline-offset-4 hover:underline">
                  <ExternalLink className="size-3.5" aria-hidden="true" />
                  <span className="truncate">{publicUrl}</span>
                </a>
              ) : null}
              <Button asChild variant="outline" size="sm" className="w-full">
                <Link to={editorPath}>
                  <Rocket />
                  Open the site editor to publish
                </Link>
              </Button>
            </CardContent>
          </Card>

          <Card className="ring-destructive/30">
            <CardContent className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">Deleting removes the campaign and its recorded gifts.</p>
              <Button type="button" variant="destructive" size="sm" onClick={() => setConfirmDelete(true)}>
                <Trash2 />
                Delete
              </Button>
            </CardContent>
          </Card>
        </aside>
      </div>

      <StoryDialog
        open={storyOpen}
        onOpenChange={setStoryOpen}
        language={lang}
        onDraft={async (brief) => {
          const result = await ai.runCampaignStory(saved.id, { brief, language: lang });
          if (!result) return false;
          setText("title", result.title);
          setText("summary", result.summary);
          setText("story", result.story);
          toast.success("Story drafted. Edit anything, then save.");
          return true;
        }}
      />

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete {saved.title}?</DialogTitle>
            <DialogDescription>
              The campaign and its {totals.giftCount} recorded {totals.giftCount === 1 ? "gift" : "gifts"} are removed. Its page comes down the next time the site is published. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={() => void remove()}>
              <Trash2 />
              Delete campaign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StoryDialog(props: { open: boolean; language: string; onOpenChange: (open: boolean) => void; onDraft: (brief: string) => Promise<boolean> }) {
  const { open, language, onOpenChange, onDraft } = props;
  const [brief, setBrief] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (brief.trim().length < 10) return;
    setBusy(true);
    try {
      if (await onDraft(brief.trim())) {
        onOpenChange(false);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={(e) => void submit(e)}>
          <DialogHeader>
            <DialogTitle>Draft the story with AI</DialogTitle>
            <DialogDescription>
              A few notes are enough: what the money does, who it helps, when. The draft is written in {languageName(language)} and replaces the title, summary and story; you can edit every line.
            </DialogDescription>
          </DialogHeader>
          <div className="my-4 space-y-1.5">
            <Label htmlFor="brief">Notes</Label>
            <Textarea
              id="brief"
              autoFocus
              rows={6}
              value={brief}
              maxLength={4000}
              onChange={(e) => setBrief(e.target.value)}
              placeholder="We open a winter shelter for forty neighbors every December. We need $5,000 for heating, cots and meals, by November 30."
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || brief.trim().length < 10}>
              {busy ? <Loader2 className="animate-spin" /> : <Sparkles />}
              {busy ? "Writing…" : "Draft story"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
