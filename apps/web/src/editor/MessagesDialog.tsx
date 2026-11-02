import { useCallback, useEffect, useState } from "react";
import { languageName } from "@ministry/schema";
import { AlertCircle, Inbox, Loader2, Mail, RefreshCw, Reply, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useBackend } from "../backend-context";
import { deliveryStatus, emptyMessagesText, MESSAGES_LIMIT, replyMailto, type ContactMessage } from "../lib/messages";
import { formatRelativeTime } from "../lib/time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSiteId } from "./EditorContext";

type Load = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; messages: ContactMessage[] };

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong.";
}

function MessageItem({
  message,
  orgName,
  busy,
  onDelete,
}: {
  message: ContactMessage;
  orgName: string;
  busy: boolean;
  onDelete: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const status = deliveryStatus(message);
  const reply = replyMailto(message, orgName);
  const when = formatRelativeTime(message.createdAt);
  const language = message.language ? languageName(message.language) : "";

  return (
    <li className="space-y-2 rounded-xl border bg-card p-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-sm font-medium">{message.name || "Anonymous"}</span>
        {reply ? (
          <a href={reply.split("?")[0]} className="rounded-sm text-sm text-brand underline-offset-4 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
            {message.email}
          </a>
        ) : (
          <span className="text-sm text-muted-foreground">{message.email}</span>
        )}
        {when ? <span className="text-xs text-muted-foreground">{when}</span> : null}
        <span className="ml-auto flex items-center gap-1.5">
          {language ? <Badge variant="secondary">{language}</Badge> : null}
          {status.delivered ? (
            <Badge variant="outline">
              <Mail aria-hidden="true" />
              {status.label}
            </Badge>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="destructive" tabIndex={0} aria-label={`${status.label}: ${status.detail}`}>
                  <AlertCircle aria-hidden="true" />
                  {status.label}
                </Badge>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-xs">
                {status.detail}
              </TooltipContent>
            </Tooltip>
          )}
        </span>
      </div>
      <p className="text-sm break-words whitespace-pre-wrap">{message.message}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        {reply ? (
          <Button asChild variant="outline" size="sm">
            <a href={reply}>
              <Reply />
              Reply
            </a>
          </Button>
        ) : null}
        <span className="ml-auto flex items-center gap-1.5">
          {confirming ? (
            <span className="flex items-center gap-1.5" role="group" aria-label="Confirm delete">
              <span className="text-sm text-muted-foreground">Delete this message?</span>
              <Button type="button" variant="destructive" size="sm" disabled={busy} onClick={onDelete}>
                {busy ? <Loader2 className="animate-spin" /> : null}
                Delete
              </Button>
              <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </span>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button type="button" variant="ghost" size="icon-sm" aria-label={`Delete message from ${message.name || message.email}`} onClick={() => setConfirming(true)}>
                  <Trash2 />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Delete</TooltipContent>
            </Tooltip>
          )}
        </span>
      </div>
    </li>
  );
}

/** The contact form inbox: messages visitors sent through the published site, newest first. */
export function MessagesDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgName: string;
  /** Where the platform emails messages; null when the contact section has no email. */
  contactEmail: string | null;
  /** Reports the true message count after a refresh or delete, for the header badge. */
  onCountChange: (count: number) => void;
}) {
  const { open, onOpenChange, orgName, contactEmail, onCountChange } = props;
  const backend = useBackend();
  const siteId = useSiteId();
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [deleting, setDeleting] = useState<string | null>(null);

  const refresh = useCallback(
    async (isCurrent: () => boolean = () => true) => {
      if (!backend.messages) return;
      setLoad((cur) => (cur.kind === "ready" ? cur : { kind: "loading" }));
      try {
        const messages = await backend.messages.list(siteId);
        if (!isCurrent()) return;
        setLoad({ kind: "ready", messages });
        // A full page means there may be more than we can see, so only trust shorter lists.
        if (messages.length < MESSAGES_LIMIT) onCountChange(messages.length);
      } catch (err) {
        if (isCurrent()) setLoad({ kind: "error", message: errorText(err) });
      }
    },
    [backend, siteId, onCountChange],
  );

  // Refresh every time the dialog opens.
  useEffect(() => {
    if (!open) return;
    let current = true;
    setLoad({ kind: "loading" });
    void refresh(() => current);
    return () => {
      current = false;
    };
  }, [open, refresh]);

  async function remove(id: string) {
    if (!backend.messages || load.kind !== "ready") return;
    setDeleting(id);
    try {
      await backend.messages.remove(siteId, id);
      const remaining = load.messages.filter((m) => m.id !== id);
      setLoad({ kind: "ready", messages: remaining });
      if (remaining.length < MESSAGES_LIMIT - 1) onCountChange(remaining.length);
      toast.success("Message deleted");
    } catch (err) {
      toast.error("Could not delete the message", { description: errorText(err) });
    } finally {
      setDeleting(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Inbox className="size-4" aria-hidden="true" />
            Messages
          </DialogTitle>
          <DialogDescription>Notes visitors sent through the contact form on your published site, newest first.</DialogDescription>
        </DialogHeader>

        {load.kind === "loading" ? (
          <div className="space-y-2" role="status" aria-label="Loading messages">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-xl" />
            ))}
          </div>
        ) : null}

        {load.kind === "error" ? (
          <div className="flex flex-col items-start gap-2">
            <p role="alert" className="flex items-start gap-2 text-sm text-destructive">
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {load.message}
            </p>
            <Button type="button" variant="outline" size="sm" onClick={() => void refresh()}>
              <RefreshCw />
              Try again
            </Button>
          </div>
        ) : null}

        {load.kind === "ready" && load.messages.length === 0 ? (
          <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">{emptyMessagesText(contactEmail)}</p>
        ) : null}

        {load.kind === "ready" && load.messages.length > 0 ? (
          <ul className="space-y-2">
            {load.messages.map((m) => (
              <MessageItem key={m.id} message={m} orgName={orgName} busy={deleting === m.id} onDelete={() => void remove(m.id)} />
            ))}
          </ul>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
