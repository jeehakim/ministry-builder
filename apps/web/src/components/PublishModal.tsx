import { Download, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const STEPS = [
  { title: "Download your site", body: "One ZIP with your page and images. Nothing else is needed." },
  { title: "Drop it on Cloudflare", body: "Drag the ZIP onto cloudflare.com/drop. You get a live preview link in seconds." },
  { title: "Claim it", body: "Click Claim, create a free Cloudflare account, and the site is yours for good." },
  { title: "Add your domain (optional)", body: "In the Cloudflare dashboard, attach a custom domain. SSL is automatic and free." },
];

export function PublishModal(props: {
  open: boolean;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onDownload: () => void;
}) {
  const { open, busy, onOpenChange, onDownload } = props;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Publish for free</DialogTitle>
          <DialogDescription>Your site is static files, so it can live on Cloudflare's free plan with no monthly cost.</DialogDescription>
        </DialogHeader>
        <ol className="space-y-3">
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
        <DialogFooter className="sm:justify-between">
          <Button asChild variant="ghost">
            <a href="https://cloudflare.com/drop" target="_blank" rel="noreferrer">
              <ExternalLink />
              Open cloudflare.com/drop
            </a>
          </Button>
          <Button type="button" disabled={busy} onClick={onDownload}>
            {busy ? <Loader2 className="animate-spin" /> : <Download />}
            {busy ? "Preparing…" : "Download ZIP"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
