import { Link } from "react-router";
import { ArrowLeft, Download, Layers, Loader2, Rocket, Sparkles } from "lucide-react";
import type { SiteInfo } from "../api";
import { AiUsagePill } from "../components/AiUsagePill";
import { Brand } from "../components/Brand";
import { PublishedBadge } from "../components/PublishedBadge";
import { SaveIndicator } from "../components/SaveIndicator";
import { ThemeToggle } from "../components/ThemeToggle";
import { UserMenu } from "../components/UserMenu";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DRAFT_BUSY_KEY, useAi } from "./AiContext";
import type { SaveState } from "./useSiteDocument";

export function EditorHeader(props: {
  orgName: string;
  save: SaveState;
  site: SiteInfo;
  exporting: boolean;
  /** A saved set of AI variations exists and can be reopened. */
  hasVariations: boolean;
  onDraft: () => void;
  onVariations: () => void;
  onExport: () => void;
  onPublish: () => void;
}) {
  const { orgName, save, site, exporting, hasVariations, onDraft, onVariations, onExport, onPublish } = props;
  const { enabled, disabledReason, busy } = useAi();
  const drafting = busy[DRAFT_BUSY_KEY] === true;
  // aria-disabled (not disabled) so keyboard users can still focus the button and hear why it is off.
  const gated = !enabled;

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b px-3">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button asChild variant="ghost" size="icon-sm" aria-label="Back to your sites">
            <Link to="/">
              <ArrowLeft />
            </Link>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Your sites</TooltipContent>
      </Tooltip>
      <Brand compact />
      <Separator orientation="vertical" className="h-5!" />
      <h1 className="min-w-0 flex-1 truncate text-sm font-medium">{orgName || "Untitled site"}</h1>

      {hasVariations ? (
        <Button variant="ghost" size="sm" onClick={onVariations}>
          <Layers />
          Variations
        </Button>
      ) : null}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            aria-disabled={gated || undefined}
            className={cn(gated && "cursor-not-allowed opacity-50")}
            onClick={() => {
              if (!gated) onDraft();
            }}
          >
            {drafting ? <Loader2 className="animate-spin" /> : <Sparkles />}
            {drafting ? "Drafting…" : "Draft with AI"}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {gated ? disabledReason : drafting ? "Your draft is being written" : "Write a full page from your notes"}
        </TooltipContent>
      </Tooltip>
      <AiUsagePill />

      <Separator orientation="vertical" className="h-5!" />
      <SaveIndicator state={save} />
      <PublishedBadge url={site.publishedUrl} />
      <Separator orientation="vertical" className="h-5!" />
      <Button variant="outline" size="sm" disabled={exporting} onClick={onExport}>
        {exporting ? <Loader2 className="animate-spin" /> : <Download />}
        Export
      </Button>
      <Button size="sm" onClick={onPublish}>
        <Rocket />
        Publish
      </Button>
      <ThemeToggle />
      <UserMenu />
    </header>
  );
}
