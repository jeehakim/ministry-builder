import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { CampaignWithTotals, Section } from "@ministry/schema";
import { HeartHandshake, Loader2 } from "lucide-react";
import { useBackend } from "../backend-context";
import { progressText, STATUS_LABELS } from "../lib/fundraising";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useSiteId } from "./EditorContext";

type GiveSection = Extract<Section, { type: "give" }>;
type Load = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; campaigns: CampaignWithTotals[] };

/**
 * Below the Give section's fields: which campaigns will appear as cards when the site is published.
 * Empty selection means every active campaign; ticking any campaign switches to an explicit list.
 */
export function GiveCampaignsPanel({ section, orgId, onChange }: { section: GiveSection; orgId: string | null; onChange: (campaigns: string[]) => void }) {
  const backend = useBackend();
  const siteId = useSiteId();
  const [load, setLoad] = useState<Load>({ kind: "loading" });

  useEffect(() => {
    const fundraising = backend.fundraising;
    if (!fundraising) return;
    let cancelled = false;
    fundraising
      .list(siteId)
      .then((campaigns) => !cancelled && setLoad({ kind: "ready", campaigns }))
      .catch((err: unknown) => {
        if (!cancelled) setLoad({ kind: "error", message: err instanceof Error ? err.message : "Could not load campaigns." });
      });
    return () => {
      cancelled = true;
    };
  }, [backend, siteId]);

  if (!backend.fundraising) return null;
  const fundraisingPath = `/fundraising${orgId ? `?org=${encodeURIComponent(orgId)}` : ""}`;

  return (
    <div className="space-y-2 border-t pt-4">
      <div className="flex items-center justify-between">
        <Label className="text-xs text-muted-foreground">Campaign cards</Label>
        <Button asChild variant="ghost" size="xs">
          <Link to={fundraisingPath}>
            <HeartHandshake />
            Fundraising
          </Link>
        </Button>
      </div>
      {load.kind === "loading" ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" aria-hidden="true" />
          Loading campaigns…
        </p>
      ) : load.kind === "error" ? (
        <p role="alert" className="text-xs text-destructive">
          {load.message}
        </p>
      ) : load.campaigns.length === 0 ? (
        <p className="rounded-lg border border-dashed px-3 py-3 text-center text-xs text-muted-foreground">No campaigns yet. Create one under Fundraising and its card appears here when it is active.</p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            {section.campaigns.length === 0 ? "Every active campaign is shown. Tick campaigns to choose which ones appear, in this order." : "Only the ticked campaigns appear. Untick all to show every active one."}
          </p>
          <ul className="space-y-1.5">
            {load.campaigns.map((c) => {
              const checked = section.campaigns.includes(c.id);
              const willShow = section.campaigns.length === 0 ? c.status === "active" : checked && c.status === "active";
              return (
                <li key={c.id} className="flex items-start gap-2 rounded-lg border bg-card p-2 text-xs">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-3.5 accent-brand"
                    aria-label={`Show ${c.title}`}
                    checked={checked}
                    onChange={(e) => onChange(e.target.checked ? [...section.campaigns, c.id] : section.campaigns.filter((id) => id !== c.id))}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate font-medium">{c.title}</span>
                      <Badge variant={c.status === "active" ? "default" : "outline"}>{STATUS_LABELS[c.status]}</Badge>
                      {willShow ? <span className="text-muted-foreground">appears on publish</span> : c.status !== "active" ? <span className="text-muted-foreground">hidden until active</span> : null}
                    </span>
                    <span className="block text-muted-foreground">{progressText(c.totals)}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
