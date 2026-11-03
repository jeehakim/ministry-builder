import { Link } from "react-router";
import { ArrowLeft, Download, Eye, HeartHandshake, Inbox, Layers, Loader2, Rocket, Settings, Sparkles } from "lucide-react";
import type { SiteInfo } from "../api";
import { useBackend } from "../backend-context";
import { AiUsagePill } from "../components/AiUsagePill";
import { Brand } from "../components/Brand";
import { PublishedBadge } from "../components/PublishedBadge";
import { SaveIndicator } from "../components/SaveIndicator";
import { HelpMenu } from "../components/HelpMenu";
import { ThemeToggle } from "../components/ThemeToggle";
import { UserMenu } from "../components/UserMenu";
import { can } from "../lib/roles";
import { OrgSwitcher } from "../orgs/OrgSwitcher";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DRAFT_BUSY_KEY, useAi } from "./AiContext";
import type { Suggestion } from "./askAi";
import { SuggestionsMenu } from "./SuggestionsMenu";
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
  onMessages: () => void;
  /** Improvements computed from the document; shown when AI is available. */
  suggestions?: Suggestion[];
  onSuggestion?: (suggestion: Suggestion) => void;
}) {
  const { orgName, save, site, exporting, hasVariations, onDraft, onVariations, onExport, onPublish, onMessages, suggestions, onSuggestion } = props;
  const backend = useBackend();
  const { enabled, disabledReason, busy } = useAi();
  const drafting = busy[DRAFT_BUSY_KEY] === true;
  // aria-disabled (not disabled) so keyboard users can still focus the button and hear why it is off.
  const gated = !enabled;
  const canEdit = can(site.role, "edit");
  const canPublish = can(site.role, "publish");
  const canUseAi = can(site.role, "ai");

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
      <OrgSwitcher leaveOnSelect />
      <Separator orientation="vertical" className="h-5!" />
      <h1 className="min-w-0 flex-1 truncate text-sm font-medium">{orgName || "Untitled site"}</h1>

      {hasVariations && canEdit ? (
        <Button variant="ghost" size="sm" onClick={onVariations}>
          <Layers />
          Variations
        </Button>
      ) : null}
      {canUseAi ? (
        <>
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
          {enabled && suggestions && onSuggestion ? <SuggestionsMenu suggestions={suggestions} onPick={onSuggestion} /> : null}
          <AiUsagePill />
        </>
      ) : null}

      <Separator orientation="vertical" className="h-5!" />
      {canEdit ? (
        <SaveIndicator state={save} />
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="secondary" tabIndex={0} className="gap-1 font-normal">
              <Eye aria-hidden="true" />
              View only
            </Badge>
          </TooltipTrigger>
          <TooltipContent side="bottom">You can look around, but only editors and above can change this site.</TooltipContent>
        </Tooltip>
      )}
      <PublishedBadge url={site.publishedUrl} />
      <Separator orientation="vertical" className="h-5!" />
      {backend.messages ? (
        <Button variant="outline" size="sm" onClick={onMessages} aria-label={site.messageCount > 0 ? `Messages, ${site.messageCount} received` : "Messages"}>
          <Inbox />
          Messages
          {site.messageCount > 0 ? (
            <span className="ml-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground tabular-nums" aria-hidden="true">
              {site.messageCount > 99 ? "99+" : site.messageCount}
            </span>
          ) : null}
        </Button>
      ) : null}
      {backend.fundraising ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button asChild variant="outline" size="sm">
              <Link to="/fundraising">
                <HeartHandshake />
                Fundraising
              </Link>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Campaigns and gifts for this organization</TooltipContent>
        </Tooltip>
      ) : null}
      <Button variant="outline" size="sm" disabled={exporting} onClick={onExport}>
        {exporting ? <Loader2 className="animate-spin" /> : <Download />}
        Export
      </Button>
      {canPublish ? (
        <Button size="sm" onClick={onPublish}>
          <Rocket />
          Publish
        </Button>
      ) : null}
      {backend.integrations ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button asChild variant="ghost" size="icon-sm" aria-label="Site settings">
              <Link to={`/sites/${encodeURIComponent(site.id)}/settings`}>
                <Settings />
              </Link>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Site settings</TooltipContent>
        </Tooltip>
      ) : null}
      <HelpMenu />
      <ThemeToggle />
      <UserMenu />
    </header>
  );
}
