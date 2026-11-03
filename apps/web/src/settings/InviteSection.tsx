import { useEffect, useId, useState, type FormEvent } from "react";
import { INVITABLE_ROLES, InvitableRole, ROLE_DESCRIPTIONS, type CreateInvitationResponse, type PendingInvitation } from "@ministry/schema";
import { Check, Copy, Info, Loader2, Send, X } from "lucide-react";
import { toast } from "sonner";
import type { OrgsBackend } from "../backend";
import { isNetworkError } from "../lib/errors";
import { formatRelativeTime } from "../lib/time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** Plain wording for a failed member action; the server's own message covers 409 (already a member) and 429 (too many invitations). */
export function memberActionError(err: unknown): string {
  if (isNetworkError(err)) return "Can't reach the server. Check your connection, then try again.";
  return err instanceof Error ? err.message : "Something went wrong.";
}

export function InlineAlert({ message }: { message: string | null }) {
  return message ? (
    <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
      {message}
    </p>
  ) : null;
}

function InviteLink({ link }: { link: string }) {
  const id = useId();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      toast.error("Could not copy. Select the link and copy it by hand.");
    }
  }

  return (
    <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        Invitation link
      </Label>
      <div className="flex gap-2">
        <Input id={id} readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
        <Button type="button" variant="outline" onClick={() => void copy()}>
          {copied ? <Check /> : <Copy />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        <span>Email is not set up on this server, so nothing was sent. Share this link yourself. It works once, for the invited address only.</span>
      </p>
    </div>
  );
}

/** Invite form, the link to hand over when email is off, and the pending invitations. Admins and owners only. */
export function InviteSection(props: {
  orgId: string;
  orgs: OrgsBackend;
  invitations: PendingInvitation[];
  onInvited: (invitation: PendingInvitation) => void;
  onRevoked: (invitationId: string) => void;
}) {
  const { orgId, orgs, invitations, onInvited, onRevoked } = props;
  const emailId = useId();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InvitableRole>("editor");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const address = email.trim();
    if (!address) return;
    setBusy(true);
    setError(null);
    setLink(null);
    try {
      const result: CreateInvitationResponse = await orgs.invite(orgId, { email: address, role });
      onInvited(result.invitation);
      setEmail("");
      if (result.delivery === "link" && result.link) {
        setLink(result.link);
        toast.success(`Invitation ready for ${result.invitation.email}`, { description: "Copy the link below and send it to them." });
      } else {
        toast.success(`Invitation sent to ${result.invitation.email}`);
      }
    } catch (err) {
      setError(memberActionError(err));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(invitation: PendingInvitation) {
    setRevoking(invitation.id);
    setError(null);
    try {
      await orgs.revokeInvitation(orgId, invitation.id);
      onRevoked(invitation.id);
      toast.success(`Invitation for ${invitation.email} cancelled`);
    } catch (err) {
      setError(memberActionError(err));
    } finally {
      setRevoking(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Invite someone</CardTitle>
        <CardDescription>They get a link that works for their email address only.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={(e) => void submit(e)} className="flex flex-wrap items-end gap-2">
          <div className="min-w-48 flex-1 space-y-1.5">
            <Label htmlFor={emailId} className="text-xs text-muted-foreground">
              Email address
            </Label>
            <Input
              id={emailId}
              type="email"
              required
              autoComplete="off"
              spellCheck={false}
              placeholder="name@example.org"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Role</Label>
            <Select
              value={role}
              onValueChange={(v) => {
                const next = InvitableRole.safeParse(v);
                if (next.success) setRole(next.data);
              }}
            >
              <SelectTrigger className="w-32 capitalize" aria-label="Role for the invitation">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INVITABLE_ROLES.map((r) => (
                  <SelectItem key={r} value={r} className="capitalize">
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button type="submit" disabled={busy || email.trim() === ""}>
            {busy ? <Loader2 className="animate-spin" /> : <Send />}
            {busy ? "Inviting…" : "Invite"}
          </Button>
        </form>
        <p className="text-xs text-muted-foreground">{ROLE_DESCRIPTIONS[role]}</p>
        <InlineAlert message={error} />
        {link ? <InviteLink link={link} /> : null}

        {invitations.length > 0 ? (
          <div className="space-y-2 border-t pt-4">
            <h3 className="text-sm font-medium">Waiting to join</h3>
            <ul className="divide-y rounded-lg border">
              {invitations.map((inv) => (
                <li key={inv.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{inv.email}</span>
                    <span className="block text-xs text-muted-foreground">
                      Sent {formatRelativeTime(inv.createdAt)}, expires {new Date(inv.expiresAt).toLocaleDateString()}
                    </span>
                  </span>
                  <Badge variant="outline" className="font-normal capitalize">
                    {inv.role}
                  </Badge>
                  <Button type="button" variant="ghost" size="sm" disabled={revoking === inv.id} onClick={() => void revoke(inv)}>
                    {revoking === inv.id ? <Loader2 className="animate-spin" /> : <X />}
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
