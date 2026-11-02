import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "@clerk/clerk-react";
import { ORG_ROLES, OrgRole, type MembersResponse, type OrgMember } from "@ministry/schema";
import { Crown, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { OrgsBackend } from "../backend";
import { useBackend } from "../backend-context";
import { ApiUnreachableBanner } from "../components/ApiUnreachableBanner";
import { isNetworkError } from "../lib/errors";
import { canChangeMember, canGrantRole, memberLabel, sortMembers, transferCandidates } from "../lib/members";
import { can } from "../lib/roles";
import { formatRelativeTime } from "../lib/time";
import { useOrg } from "../orgs/OrgContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { InlineAlert, InviteSection, memberActionError } from "./InviteSection";

type Load = { kind: "loading" } | { kind: "error"; message: string; network: boolean } | { kind: "ready"; data: MembersResponse };

/**
 * Who belongs to the organization. Everyone sees the list; admins and owners can change roles, remove people and invite;
 * owners can also hand ownership to someone else. `onCallerRoleChanged` fires when the caller's own role may have changed.
 */
export function MembersPanel(props: { orgId: string; orgName: string; role: OrgRole; onCallerRoleChanged: () => void }) {
  const { orgId, orgName, role, onCallerRoleChanged } = props;
  const { orgs } = useBackend();
  const { userId } = useAuth();
  const navigate = useNavigate();
  const org = useOrg();
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  // Bumped by the banner's retry button to load again.
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busyUser, setBusyUser] = useState<string | null>(null);
  const [pendingRemove, setPendingRemove] = useState<OrgMember | null>(null);
  const canManage = can(role, "manageMembers");

  const reload = useCallback(async (backend: OrgsBackend) => {
    try {
      setLoad({ kind: "ready", data: await backend.members(orgId) });
    } catch (err) {
      setLoad({ kind: "error", message: memberActionError(err), network: isNetworkError(err) });
    }
  }, [orgId]);

  useEffect(() => {
    if (!orgs) return;
    let cancelled = false;
    setLoad({ kind: "loading" });
    orgs
      .members(orgId)
      .then((data) => !cancelled && setLoad({ kind: "ready", data }))
      .catch((err: unknown) => {
        if (!cancelled) setLoad({ kind: "error", message: memberActionError(err), network: isNetworkError(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [orgs, orgId, attempt]);

  const members = useMemo(() => (load.kind === "ready" ? sortMembers(load.data.members) : []), [load]);

  if (!orgs) return <p className="text-sm text-muted-foreground">Members need a Ministry Sites account.</p>;
  if (load.kind === "loading") return <Skeleton className="h-48 rounded-xl" />;
  if (load.kind === "error") {
    return load.network ? <ApiUnreachableBanner onRetry={() => setAttempt((n) => n + 1)} /> : <InlineAlert message={load.message} />;
  }

  const { data } = load;
  // Functional, so two actions finishing close together cannot overwrite each other's change.
  const patch = (fn: (current: MembersResponse) => MembersResponse) => setLoad((cur) => (cur.kind === "ready" ? { kind: "ready", data: fn(cur.data) } : cur));

  async function changeRole(member: OrgMember, next: OrgRole) {
    if (!orgs || next === member.role) return;
    setBusyUser(member.userId);
    setError(null);
    try {
      const updated = await orgs.updateMember(orgId, member.userId, next);
      patch((d) => ({ ...d, members: d.members.map((m) => (m.userId === updated.userId ? updated : m)) }));
      toast.success(`${memberLabel(updated)} is now ${updated.role === "admin" ? "an" : "a"} ${updated.role}`);
      if (member.userId === userId) {
        void org.refresh();
        onCallerRoleChanged();
      }
    } catch (err) {
      setError(memberActionError(err));
    } finally {
      setBusyUser(null);
    }
  }

  async function remove(member: OrgMember) {
    if (!orgs) return;
    setBusyUser(member.userId);
    setError(null);
    try {
      await orgs.removeMember(orgId, member.userId);
      setPendingRemove(null);
      if (member.userId === userId) {
        toast.success(`You left ${orgName}`);
        await org.refresh();
        void navigate("/", { replace: true });
        return;
      }
      patch((d) => ({ ...d, members: d.members.filter((m) => m.userId !== member.userId) }));
      toast.success(`${memberLabel(member)} removed`);
    } catch (err) {
      setPendingRemove(null);
      setError(memberActionError(err));
    } finally {
      setBusyUser(null);
    }
  }

  const removing = pendingRemove?.userId === userId;

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
          <CardDescription>
            {canManage ? `People who can work in ${orgName}. Roles apply to every site in it.` : `People who work in ${orgName}. Only admins and owners can change this list.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <InlineAlert message={error} />
          <ul className="divide-y rounded-lg border" aria-label="Members">
            {members.map((m) => {
              const mine = m.userId === userId;
              const editable = canChangeMember(role, m.role);
              const busy = busyUser === m.userId;
              return (
                <li key={m.userId} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className={m.email ? "truncate text-sm font-medium" : "truncate text-sm font-medium text-muted-foreground"}>{memberLabel(m)}</span>
                      {mine ? <Badge variant="outline" className="font-normal">You</Badge> : null}
                    </span>
                    <span className="block text-xs text-muted-foreground">Joined {formatRelativeTime(m.joinedAt)}</span>
                  </span>
                  {editable ? (
                    <Select
                      value={m.role}
                      disabled={busy}
                      onValueChange={(v) => {
                        const next = OrgRole.safeParse(v);
                        if (next.success) void changeRole(m, next.data);
                      }}
                    >
                      <SelectTrigger size="sm" className="w-28 capitalize" aria-label={`Role for ${memberLabel(m)}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ORG_ROLES.map((r) => (
                          <SelectItem key={r} value={r} disabled={!canGrantRole(role, r)} className="capitalize">
                            {r}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Badge variant={m.role === "owner" ? "default" : "secondary"} className="font-normal capitalize">
                      {m.role}
                    </Badge>
                  )}
                  {editable ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      aria-label={mine ? "Leave this organization" : `Remove ${memberLabel(m)}`}
                      onClick={() => setPendingRemove(m)}
                    >
                      {busy ? <Loader2 className="animate-spin" /> : <Trash2 />}
                      {mine ? "Leave" : "Remove"}
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      {canManage ? (
        <InviteSection
          orgId={orgId}
          orgs={orgs}
          invitations={data.invitations}
          onInvited={(invitation) => patch((d) => ({ ...d, invitations: [invitation, ...d.invitations.filter((i) => i.id !== invitation.id)] }))}
          onRevoked={(id) => patch((d) => ({ ...d, invitations: d.invitations.filter((i) => i.id !== id) }))}
        />
      ) : null}

      {can(role, "transferOwnership") ? (
        <TransferCard
          orgId={orgId}
          orgName={orgName}
          orgs={orgs}
          candidates={transferCandidates(members, userId)}
          onTransferred={() => {
            void org.refresh();
            void reload(orgs);
            onCallerRoleChanged();
          }}
        />
      ) : null}

      <Dialog open={pendingRemove !== null} onOpenChange={(o) => !o && busyUser === null && setPendingRemove(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{removing ? `Leave ${orgName}?` : `Remove ${pendingRemove ? memberLabel(pendingRemove) : ""}?`}</DialogTitle>
            <DialogDescription>
              {removing
                ? "You will lose access to every site in this organization. Someone with the right role would have to invite you back."
                : "They lose access to every site in this organization right away. You can invite them again later."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busyUser !== null} onClick={() => setPendingRemove(null)}>
              Keep
            </Button>
            <Button type="button" variant="destructive" disabled={busyUser !== null} onClick={() => pendingRemove && void remove(pendingRemove)}>
              {busyUser !== null ? <Loader2 className="animate-spin" /> : <Trash2 />}
              {removing ? "Leave" : "Remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TransferCard(props: {
  orgId: string;
  orgName: string;
  orgs: OrgsBackend;
  candidates: OrgMember[];
  onTransferred: () => void;
}) {
  const { orgId, orgName, orgs, candidates, onTransferred } = props;
  const [target, setTarget] = useState<string>("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chosen = candidates.find((m) => m.userId === target) ?? null;

  async function transfer() {
    if (!chosen) return;
    setBusy(true);
    setError(null);
    try {
      await orgs.transferOwnership(orgId, chosen.userId);
      toast.success(`${memberLabel(chosen)} now owns ${orgName}`, { description: "You are an admin now." });
      setOpen(false);
      setTarget("");
      onTransferred();
    } catch (err) {
      setOpen(false);
      setError(memberActionError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Crown className="size-4" aria-hidden="true" />
          Transfer ownership
        </CardTitle>
        <CardDescription>Hand {orgName} to another member. You stay on as an admin.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <InlineAlert message={error} />
        {candidates.length === 0 ? (
          <p className="text-sm text-muted-foreground">Invite someone first. Ownership can only go to an existing member.</p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Select value={target} onValueChange={setTarget}>
              <SelectTrigger className="w-64 max-w-full" aria-label="New owner">
                <SelectValue placeholder="Choose a member" />
              </SelectTrigger>
              <SelectContent>
                {candidates.map((m) => (
                  <SelectItem key={m.userId} value={m.userId}>
                    {memberLabel(m)} ({m.role})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="button" variant="outline" disabled={!chosen} onClick={() => setOpen(true)}>
              Transfer…
            </Button>
          </div>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Make {chosen ? memberLabel(chosen) : "this member"} the owner?</DialogTitle>
            <DialogDescription>
              They will be able to delete sites and transfer ownership. You become an admin, and only the new owner can give ownership back.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="button" disabled={busy || !chosen} onClick={() => void transfer()}>
              {busy ? <Loader2 className="animate-spin" /> : <Crown />}
              {busy ? "Transferring…" : "Transfer ownership"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
