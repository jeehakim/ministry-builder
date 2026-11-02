import { useEffect, useState } from "react";
import { Check, ChevronDown, Copy, Download, ExternalLink, Globe, Loader2, Rocket } from "lucide-react";
import { toast } from "sonner";
import type { SiteInfo } from "../api";
import { useBackend } from "../backend-context";
import { useSiteId } from "../editor/EditorContext";
import { formatRelativeTime } from "../lib/time";
import { safeHttpUrl } from "../lib/urls";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

const STEPS = [
  { title: "Download your site", body: "One ZIP with your page and images. Nothing else is needed." },
  { title: "Drop it on Cloudflare", body: "Drag the ZIP onto cloudflare.com/drop. You get a live preview link in seconds." },
  { title: "Claim it", body: "Click Claim, create a free Cloudflare account, and the site is yours for good." },
  { title: "Add your domain (optional)", body: "In the Cloudflare dashboard, attach a custom domain. SSL is automatic and free." },
];

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong.";
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      toast.error("Could not copy. Select the link and copy it by hand.");
    }
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={() => void copy()}>
      {copied ? <Check /> : <Copy />}
      {copied ? "Copied" : "Copy link"}
    </Button>
  );
}

/** Section (a): one-click publishing on Ministry Sites. Only rendered when the backend supports it. */
function HostedPublish(props: {
  site: SiteInfo;
  onSiteChange: (patch: Partial<SiteInfo>) => void;
  beforePublish: () => Promise<void>;
}) {
  const { site, onSiteChange, beforePublish } = props;
  const backend = useBackend();
  const siteId = useSiteId();
  const [working, setWorking] = useState<"publish" | "unpublish" | null>(null);
  const [confirmUnpublish, setConfirmUnpublish] = useState(false);

  const liveUrl = safeHttpUrl(site.publishedUrl);
  const published = liveUrl !== null;

  async function publish() {
    if (!backend.publish) return;
    setWorking("publish");
    try {
      // Publishing serves the last saved version, so make sure pending edits are in it.
      await beforePublish();
      const result = await backend.publish(siteId);
      onSiteChange({ publishedUrl: result.url, publishedAt: result.publishedAt });
      toast.success(published ? "Changes published" : "Your site is live", { description: result.url });
    } catch (err) {
      toast.error("Could not publish", { description: errorText(err) });
    } finally {
      setWorking(null);
    }
  }

  async function unpublish() {
    if (!backend.unpublish) return;
    setWorking("unpublish");
    try {
      await backend.unpublish(siteId);
      onSiteChange({ publishedUrl: null, publishedAt: null });
      setConfirmUnpublish(false);
      toast.success("Site unpublished", { description: "The public link no longer shows your page." });
    } catch (err) {
      toast.error("Could not unpublish", { description: errorText(err) });
    } finally {
      setWorking(null);
    }
  }

  return (
    <section aria-labelledby="publish-hosted" className="space-y-3">
      <div>
        <h3 id="publish-hosted" className="text-sm font-semibold">
          Publish on Ministry Sites (free)
        </h3>
        <p className="text-sm text-muted-foreground">
          We host the page for you at a free address. Publish again after any edit to update it.
        </p>
      </div>

      {published ? (
        <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
          <p className="flex items-center gap-2 text-sm">
            <span className="size-2 rounded-full bg-emerald-500" aria-hidden="true" />
            <span className="font-medium">
              Published{site.publishedAt ? ` ${formatRelativeTime(site.publishedAt)}` : ""}
            </span>
          </p>
          <a
            href={liveUrl}
            target="_blank"
            rel="noreferrer"
            className="block truncate rounded-sm text-sm text-brand underline-offset-4 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            {liveUrl}
          </a>
          <div className="flex flex-wrap gap-1.5">
            <CopyButton text={liveUrl} />
            <Button asChild variant="outline" size="sm">
              <a href={liveUrl} target="_blank" rel="noreferrer">
                <ExternalLink />
                Open
              </a>
            </Button>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" disabled={working !== null} onClick={() => void publish()}>
          {working === "publish" ? <Loader2 className="animate-spin" /> : <Rocket />}
          {working === "publish" ? "Publishing…" : published ? "Publish changes" : "Publish now"}
        </Button>
        {published && !confirmUnpublish ? (
          <Button type="button" variant="ghost" disabled={working !== null} onClick={() => setConfirmUnpublish(true)}>
            Unpublish
          </Button>
        ) : null}
        {published && confirmUnpublish ? (
          <span className="flex items-center gap-1.5" role="group" aria-label="Confirm unpublish">
            <span className="text-sm text-muted-foreground">Take the site offline?</span>
            <Button type="button" variant="destructive" size="sm" disabled={working !== null} onClick={() => void unpublish()}>
              {working === "unpublish" ? <Loader2 className="animate-spin" /> : null}
              Yes, unpublish
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={working !== null} onClick={() => setConfirmUnpublish(false)}>
              Keep it live
            </Button>
          </span>
        ) : null}
      </div>
    </section>
  );
}

/** Section (b): download a ZIP and host it anywhere, with the Cloudflare Drop walkthrough. */
function SelfHost({ busy, onDownload }: { busy: boolean; onDownload: () => void }) {
  const [showSteps, setShowSteps] = useState(false);
  return (
    <section aria-labelledby="publish-self" className="space-y-3">
      <div>
        <h3 id="publish-self" className="text-sm font-semibold">
          Host it yourself
        </h3>
        <p className="text-sm text-muted-foreground">
          Your site is static files, so it can live on Cloudflare's free plan with no monthly cost.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" disabled={busy} onClick={onDownload}>
          {busy ? <Loader2 className="animate-spin" /> : <Download />}
          {busy ? "Preparing…" : "Download ZIP"}
        </Button>
        <Button asChild variant="ghost">
          <a href="https://cloudflare.com/drop" target="_blank" rel="noreferrer">
            <ExternalLink />
            Open cloudflare.com/drop
          </a>
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-expanded={showSteps}
          aria-controls="publish-steps"
          onClick={() => setShowSteps((v) => !v)}
        >
          <ChevronDown className={cn(showSteps && "rotate-180")} />
          {showSteps ? "Hide steps" : "Show steps"}
        </Button>
      </div>
      {showSteps ? (
        <ol id="publish-steps" className="space-y-3">
          {STEPS.map((step, i) => (
            <li key={step.title} className="flex gap-3">
              <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-brand-soft text-xs font-semibold text-brand">
                {i + 1}
              </span>
              <div>
                <p className="text-sm font-medium">{step.title}</p>
                <p className="text-sm text-muted-foreground">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}

export function PublishModal(props: {
  open: boolean;
  /** True while the ZIP is being built. */
  busy: boolean;
  site: SiteInfo;
  onOpenChange: (open: boolean) => void;
  onDownload: () => void;
  onSiteChange: (patch: Partial<SiteInfo>) => void;
  /** Saves pending edits and resolves when they are stored; rejects if they cannot be. */
  beforePublish: () => Promise<void>;
}) {
  const { open, busy, site, onOpenChange, onDownload, onSiteChange, beforePublish } = props;
  const backend = useBackend();
  const canHost = backend.publish !== undefined;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Globe className="size-4" aria-hidden="true" />
            Publish your site
          </DialogTitle>
          <DialogDescription>
            {canHost ? "Go live in one click, or take the files and host them anywhere." : "Take your site's files and host them for free."}
          </DialogDescription>
        </DialogHeader>
        {canHost ? (
          <>
            <HostedPublish site={site} onSiteChange={onSiteChange} beforePublish={beforePublish} />
            <Separator />
          </>
        ) : null}
        <SelfHost busy={busy} onDownload={onDownload} />
      </DialogContent>
    </Dialog>
  );
}
