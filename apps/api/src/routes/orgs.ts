import {
  CreateInvitationRequest,
  roleAtLeast,
  TransferOwnershipRequest,
  UpdateMemberRequest,
  type AcceptInvitationResponse,
  type CreateInvitationResponse,
  type EventsResponse,
  type InvitableRole,
  type InvitationPreview,
  type MembersResponse,
  type OrgEvent,
  type OrgMember as OrgMemberView,
  type OrgRole,
  type OrgsResponse,
  type PendingInvitation,
} from "@ministry/schema";
import { and, asc, count, desc, eq, gt, gte, isNull } from "drizzle-orm";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { hasRole, requireOrgRole } from "../access";
import { orgEvents, orgInvitations, orgMembers, organizations, users, type OrgInvitation } from "../db/schema";
import { createSender } from "../email";
import { invitationEmail } from "../email/invitation";
import { orgEventInsert, recordOrgEvent } from "../events";
import { newId } from "../ids";
import {
  hashInvitationToken,
  INVITATION_TOKEN_PATTERN,
  INVITATION_TTL_MS,
  invitationLink,
  MAX_INVITATIONS_PER_DAY,
  maskEmail,
  newInvitationToken,
} from "../invitations";
import { errorFields, logError, requestIdOf } from "../log";
import type { AppEnv } from "../types";

type Ctx = Context<AppEnv>;

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_EVENTS = 100;
const MAX_EVENTS = 500;

const limit4k = bodyLimit({ maxSize: 4 * 1024, onError: (c) => c.json({ error: "Body too large" }, 413) });

async function parse<T>(c: Ctx, schema: { safeParse(v: unknown): { success: true; data: T } | { success: false; error: { issues: { message: string }[] } } }): Promise<T | Response> {
  const parsed = schema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, 400);
  return parsed.data;
}

async function countOwners(db: DrizzleD1Database, orgId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(orgMembers)
    .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.role, "owner")));
  return row?.n ?? 0;
}

/**
 * Keeps `organizations.owner_user_id` (used by listings and the sites-per-user limit) pointing at an owner
 * member: when the current one no longer is, the longest-standing owner takes over.
 */
async function syncPrimaryOwner(db: DrizzleD1Database, orgId: string): Promise<void> {
  const [org] = await db.select({ ownerUserId: organizations.ownerUserId }).from(organizations).where(eq(organizations.id, orgId)).limit(1);
  if (!org) return;
  const [current] = await db
    .select({ userId: orgMembers.userId })
    .from(orgMembers)
    .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, org.ownerUserId), eq(orgMembers.role, "owner")))
    .limit(1);
  if (current) return;
  const [next] = await db
    .select({ userId: orgMembers.userId })
    .from(orgMembers)
    .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.role, "owner")))
    .orderBy(asc(orgMembers.joinedAt), asc(orgMembers.userId))
    .limit(1);
  if (next) await db.update(organizations).set({ ownerUserId: next.userId }).where(eq(organizations.id, orgId));
}

async function loadMember(db: DrizzleD1Database, orgId: string, userId: string) {
  const [row] = await db
    .select({ userId: orgMembers.userId, email: users.email, role: orgMembers.role, invitedBy: orgMembers.invitedBy, joinedAt: orgMembers.joinedAt })
    .from(orgMembers)
    .innerJoin(users, eq(orgMembers.userId, users.id))
    .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, userId)))
    .limit(1);
  return row;
}

function memberView(row: { userId: string; email: string | null; role: OrgRole; invitedBy: string | null; joinedAt: Date }): OrgMemberView {
  return { userId: row.userId, email: row.email, role: row.role, invitedBy: row.invitedBy, joinedAt: row.joinedAt.toISOString() };
}

function invitationView(row: OrgInvitation): PendingInvitation {
  return {
    id: row.id,
    email: row.email,
    role: row.role as InvitableRole,
    invitedBy: row.invitedBy,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

/** A pending invitation by its token, or null when unknown, accepted or expired. Expired rows are removed on sight. */
async function pendingByToken(db: DrizzleD1Database, token: string) {
  if (!INVITATION_TOKEN_PATTERN.test(token)) return null;
  const tokenHash = await hashInvitationToken(token);
  const [row] = await db
    .select({ invitation: orgInvitations, orgName: organizations.name })
    .from(orgInvitations)
    .innerJoin(organizations, eq(orgInvitations.orgId, organizations.id))
    .where(eq(orgInvitations.tokenHash, tokenHash))
    .limit(1);
  if (!row || row.invitation.acceptedAt) return null;
  if (row.invitation.expiresAt.getTime() <= Date.now()) {
    await db.delete(orgInvitations).where(eq(orgInvitations.id, row.invitation.id));
    return null;
  }
  return row;
}

async function emailOf(db: DrizzleD1Database, userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const [row] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
  return row?.email ?? null;
}

export const orgRoutes = new Hono<AppEnv>();

/** The caller's organizations with their role in each. */
orgRoutes.get("/orgs", async (c) => {
  const db = drizzle(c.env.DB);
  const rows = await db
    .select({ id: organizations.id, name: organizations.name, role: orgMembers.role, createdAt: organizations.createdAt })
    .from(orgMembers)
    .innerJoin(organizations, eq(orgMembers.orgId, organizations.id))
    .where(eq(orgMembers.userId, c.var.user.id))
    .orderBy(asc(organizations.name), asc(organizations.id));
  const body: OrgsResponse = { orgs: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })) };
  return c.json(body);
});

orgRoutes.get("/orgs/:id/members", async (c) => {
  const db = drizzle(c.env.DB);
  const access = await requireOrgRole(c, db, c.req.param("id"), "viewer");
  if (access instanceof Response) return access;

  const members = await db
    .select({ userId: orgMembers.userId, email: users.email, role: orgMembers.role, invitedBy: orgMembers.invitedBy, joinedAt: orgMembers.joinedAt })
    .from(orgMembers)
    .innerJoin(users, eq(orgMembers.userId, users.id))
    .where(eq(orgMembers.orgId, access.org.id))
    .orderBy(asc(orgMembers.joinedAt), asc(orgMembers.userId));

  // Invitee addresses are for those who manage the team.
  const invitations = hasRole(access, "admin")
    ? await db
        .select()
        .from(orgInvitations)
        .where(and(eq(orgInvitations.orgId, access.org.id), isNull(orgInvitations.acceptedAt), gt(orgInvitations.expiresAt, new Date())))
        .orderBy(desc(orgInvitations.createdAt))
    : [];

  const body: MembersResponse = { members: members.map(memberView), invitations: invitations.map(invitationView) };
  return c.json(body);
});

orgRoutes.patch("/orgs/:id/members/:userId", limit4k, async (c) => {
  const db = drizzle(c.env.DB);
  const access = await requireOrgRole(c, db, c.req.param("id"), "admin");
  if (access instanceof Response) return access;
  const body = await parse(c, UpdateMemberRequest);
  if (body instanceof Response) return body;

  const target = await loadMember(db, access.org.id, c.req.param("userId"));
  if (!target) return c.json({ error: "Member not found" }, 404);

  const touchesOwner = target.role === "owner" || body.role === "owner";
  if (touchesOwner && !hasRole(access, "owner")) return c.json({ error: "Only an owner can grant or remove the owner role" }, 403);
  if (target.role === "owner" && body.role !== "owner" && (await countOwners(db, access.org.id)) <= 1) {
    return c.json({ error: "An organization needs at least one owner. Make someone else an owner first." }, 409);
  }
  if (target.role === body.role) return c.json({ member: memberView(target) });

  await db.batch([
    db.update(orgMembers).set({ role: body.role }).where(and(eq(orgMembers.orgId, access.org.id), eq(orgMembers.userId, target.userId))),
    orgEventInsert(db, {
      orgId: access.org.id,
      actorUserId: c.var.user.id,
      action: "member.role_changed",
      target: target.userId,
      detail: { email: target.email, from: target.role, to: body.role },
    }),
  ]);
  await syncPrimaryOwner(db, access.org.id);
  return c.json({ member: memberView({ ...target, role: body.role }) });
});

/** Removes a member (admin or owner), or lets any member leave (`:userId` is their own id). */
orgRoutes.delete("/orgs/:id/members/:userId", async (c) => {
  const db = drizzle(c.env.DB);
  const leaving = c.req.param("userId") === c.var.user.id;
  const access = await requireOrgRole(c, db, c.req.param("id"), leaving ? "viewer" : "admin");
  if (access instanceof Response) return access;

  const target = await loadMember(db, access.org.id, c.req.param("userId"));
  if (!target) return c.json({ error: "Member not found" }, 404);
  if (target.role === "owner") {
    if (!leaving && !hasRole(access, "owner")) return c.json({ error: "Only an owner can remove an owner" }, 403);
    if ((await countOwners(db, access.org.id)) <= 1) {
      return c.json({ error: "An organization needs at least one owner. Transfer ownership first." }, 409);
    }
  }

  await db.batch([
    db.delete(orgMembers).where(and(eq(orgMembers.orgId, access.org.id), eq(orgMembers.userId, target.userId))),
    orgEventInsert(db, {
      orgId: access.org.id,
      actorUserId: c.var.user.id,
      action: "member.removed",
      target: target.userId,
      detail: { email: target.email, role: target.role, self: target.userId === c.var.user.id },
    }),
  ]);
  await syncPrimaryOwner(db, access.org.id);
  return c.json({ ok: true });
});

orgRoutes.post("/orgs/:id/invitations", limit4k, async (c) => {
  const db = drizzle(c.env.DB);
  const access = await requireOrgRole(c, db, c.req.param("id"), "admin");
  if (access instanceof Response) return access;
  const body = await parse(c, CreateInvitationRequest);
  if (body instanceof Response) return body;
  const { email, role } = body;

  const [already] = await db
    .select({ userId: orgMembers.userId })
    .from(orgMembers)
    .innerJoin(users, eq(orgMembers.userId, users.id))
    .where(and(eq(orgMembers.orgId, access.org.id), eq(users.email, email)))
    .limit(1);
  if (already) return c.json({ error: "That person is already a member of this organization" }, 409);

  // Counted on the append-only audit log, so revoking or replacing invitations frees no slots: the limit exists to stop address spam.
  const [recent] = await db
    .select({ n: count() })
    .from(orgEvents)
    .where(and(eq(orgEvents.orgId, access.org.id), eq(orgEvents.action, "member.invited"), gte(orgEvents.createdAt, new Date(Date.now() - DAY_MS))));
  if ((recent?.n ?? 0) >= MAX_INVITATIONS_PER_DAY) {
    return c.json({ error: `Too many invitations (${MAX_INVITATIONS_PER_DAY} per day). Try again tomorrow.`, limit: MAX_INVITATIONS_PER_DAY }, 429);
  }

  const token = newInvitationToken();
  const now = new Date();
  const row: OrgInvitation = {
    id: newId("inv"),
    orgId: access.org.id,
    email,
    role,
    tokenHash: await hashInvitationToken(token),
    invitedBy: c.var.user.id,
    expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
    acceptedAt: null,
    createdAt: now,
  };
  await db.batch([
    // A new invitation to the same address replaces the pending one, so only the newest link works.
    db.delete(orgInvitations).where(and(eq(orgInvitations.orgId, access.org.id), eq(orgInvitations.email, email), isNull(orgInvitations.acceptedAt))),
    db.insert(orgInvitations).values(row),
    orgEventInsert(db, { orgId: access.org.id, actorUserId: c.var.user.id, action: "member.invited", target: email, detail: { role } }),
  ]);

  const link = invitationLink(c.env, token);
  const sender = createSender(c.env);
  if (!sender) {
    const body: CreateInvitationResponse = { invitation: invitationView(row), delivery: "link", link };
    return c.json(body, 201);
  }
  try {
    await sender.send(invitationEmail({ to: email, orgName: access.org.name, role, inviterEmail: c.var.user.email, link, expiresAt: row.expiresAt }));
  } catch (err) {
    logError("invitation_send_failed", requestIdOf(c), { org_id: access.org.id, ...errorFields(err) });
    await db.delete(orgInvitations).where(eq(orgInvitations.id, row.id));
    return c.json({ error: "The invitation email could not be sent. Try again in a moment." }, 502);
  }
  const response: CreateInvitationResponse = { invitation: invitationView(row), delivery: "email" };
  return c.json(response, 201);
});

orgRoutes.delete("/orgs/:id/invitations/:invitationId", async (c) => {
  const db = drizzle(c.env.DB);
  const access = await requireOrgRole(c, db, c.req.param("id"), "admin");
  if (access instanceof Response) return access;
  const [row] = await db
    .select()
    .from(orgInvitations)
    .where(and(eq(orgInvitations.id, c.req.param("invitationId")), eq(orgInvitations.orgId, access.org.id), isNull(orgInvitations.acceptedAt)))
    .limit(1);
  if (!row) return c.json({ error: "Invitation not found" }, 404);
  await db.batch([
    db.delete(orgInvitations).where(eq(orgInvitations.id, row.id)),
    orgEventInsert(db, { orgId: access.org.id, actorUserId: c.var.user.id, action: "invitation.revoked", target: row.email, detail: { role: row.role } }),
  ]);
  return c.json({ ok: true });
});

/** Public: what the link leads to. The token is the only credential, so the answer is deliberately small. */
orgRoutes.get("/invitations/:token", async (c) => {
  const db = drizzle(c.env.DB);
  const found = await pendingByToken(db, c.req.param("token"));
  if (!found) return c.json({ error: "This invitation is no longer valid" }, 404);
  const body: InvitationPreview = {
    orgName: found.orgName,
    role: found.invitation.role as InvitableRole,
    inviterEmail: await emailOf(db, found.invitation.invitedBy),
    email: maskEmail(found.invitation.email),
    expiresAt: found.invitation.expiresAt.toISOString(),
  };
  return c.json(body, 200, { "Cache-Control": "no-store" });
});

/** Binds the invitation to the signed-in user, who must have signed in with the invited address. */
orgRoutes.post("/invitations/:token/accept", async (c) => {
  const db = drizzle(c.env.DB);
  const found = await pendingByToken(db, c.req.param("token"));
  if (!found) return c.json({ error: "This invitation is no longer valid" }, 404);
  const { invitation } = found;
  const user = c.var.user;
  if (!user.email || user.email.toLowerCase() !== invitation.email) {
    return c.json({ error: `This invitation was sent to ${maskEmail(invitation.email)}. Sign in with that address to accept it.`, email: maskEmail(invitation.email) }, 403);
  }

  const existing = await loadMember(db, invitation.orgId, user.id);
  // Joining never lowers a role someone already holds.
  const role: OrgRole = existing && roleAtLeast(existing.role, invitation.role) ? existing.role : invitation.role;
  await db.batch([
    existing
      ? db.update(orgMembers).set({ role }).where(and(eq(orgMembers.orgId, invitation.orgId), eq(orgMembers.userId, user.id)))
      : db.insert(orgMembers).values({ orgId: invitation.orgId, userId: user.id, role, invitedBy: invitation.invitedBy }),
    db.update(orgInvitations).set({ acceptedAt: new Date() }).where(eq(orgInvitations.id, invitation.id)),
    orgEventInsert(db, { orgId: invitation.orgId, actorUserId: user.id, action: "member.joined", target: user.id, detail: { email: user.email, role } }),
  ]);
  const body: AcceptInvitationResponse = { orgId: invitation.orgId, orgName: found.orgName, role };
  return c.json(body);
});

/** Makes another member the owner; the caller steps down to admin. Other owners keep their role. */
orgRoutes.post("/orgs/:id/transfer-ownership", limit4k, async (c) => {
  const db = drizzle(c.env.DB);
  const access = await requireOrgRole(c, db, c.req.param("id"), "owner");
  if (access instanceof Response) return access;
  const body = await parse(c, TransferOwnershipRequest);
  if (body instanceof Response) return body;

  const target = await loadMember(db, access.org.id, body.userId);
  if (!target) return c.json({ error: "That person is not a member of this organization" }, 404);
  if (target.userId === c.var.user.id) return c.json({ error: "You already own this organization" }, 409);

  const caller = await loadMember(db, access.org.id, c.var.user.id);
  await db.batch([
    db.update(orgMembers).set({ role: "owner" }).where(and(eq(orgMembers.orgId, access.org.id), eq(orgMembers.userId, target.userId))),
    db.update(organizations).set({ ownerUserId: target.userId }).where(eq(organizations.id, access.org.id)),
    orgEventInsert(db, {
      orgId: access.org.id,
      actorUserId: c.var.user.id,
      action: "ownership.transferred",
      target: target.userId,
      detail: { email: target.email, from: c.var.user.id },
    }),
  ]);
  // Staff acting without a membership have nothing to step down from.
  if (caller?.role === "owner") {
    await db.update(orgMembers).set({ role: "admin" }).where(and(eq(orgMembers.orgId, access.org.id), eq(orgMembers.userId, caller.userId)));
  }
  return c.json({ orgId: access.org.id, ownerUserId: target.userId });
});

orgRoutes.get("/orgs/:id/events", async (c) => {
  const db = drizzle(c.env.DB);
  const access = await requireOrgRole(c, db, c.req.param("id"), "viewer");
  if (access instanceof Response) return access;
  const requested = Number.parseInt(c.req.query("limit") ?? "", 10);
  const limit = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), MAX_EVENTS) : DEFAULT_EVENTS;

  const rows = await db
    .select({ event: orgEvents, actorEmail: users.email })
    .from(orgEvents)
    .leftJoin(users, eq(orgEvents.actorUserId, users.id))
    .where(eq(orgEvents.orgId, access.org.id))
    .orderBy(desc(orgEvents.createdAt), desc(orgEvents.id))
    .limit(limit);
  const events: OrgEvent[] = rows.map(({ event, actorEmail }) => ({
    id: event.id,
    action: event.action,
    actorUserId: event.actorUserId,
    actorEmail: event.actorUserId ? actorEmail : null,
    target: event.target,
    detail: parseDetail(event.detailJson),
    createdAt: event.createdAt.toISOString(),
  }));
  const body: EventsResponse = { events };
  return c.json(body);
});

function parseDetail(json: string | null): Record<string, unknown> | null {
  if (!json) return null;
  try {
    const parsed: unknown = JSON.parse(json);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Removes a deleted Clerk account from every organization, promoting a replacement owner where it was the last one. */
export async function removeUserEverywhere(db: DrizzleD1Database, userId: string): Promise<{ organizations: number }> {
  const memberships = await db
    .select({ orgId: orgMembers.orgId, role: orgMembers.role })
    .from(orgMembers)
    .where(eq(orgMembers.userId, userId));
  const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);

  for (const membership of memberships) {
    await db.batch([
      db.delete(orgMembers).where(and(eq(orgMembers.orgId, membership.orgId), eq(orgMembers.userId, userId))),
      orgEventInsert(db, {
        orgId: membership.orgId,
        actorUserId: null,
        action: "member.removed",
        target: userId,
        detail: { email: user?.email ?? null, role: membership.role, reason: "account_deleted" },
      }),
    ]);
    if (membership.role === "owner" && (await countOwners(db, membership.orgId)) === 0) {
      // The most capable, longest-standing remaining member keeps the organization reachable.
      const remaining = await db
        .select({ userId: orgMembers.userId, role: orgMembers.role, email: users.email })
        .from(orgMembers)
        .innerJoin(users, eq(orgMembers.userId, users.id))
        .where(eq(orgMembers.orgId, membership.orgId))
        .orderBy(asc(orgMembers.joinedAt), asc(orgMembers.userId));
      const pick = (["admin", "editor", "viewer"] as const).map((r) => remaining.find((m) => m.role === r)).find(Boolean);
      if (pick) {
        await db.batch([
          db.update(orgMembers).set({ role: "owner" }).where(and(eq(orgMembers.orgId, membership.orgId), eq(orgMembers.userId, pick.userId))),
          orgEventInsert(db, {
            orgId: membership.orgId,
            actorUserId: null,
            action: "member.role_changed",
            target: pick.userId,
            detail: { email: pick.email, from: pick.role, to: "owner", reason: "previous_owner_deleted" },
          }),
        ]);
      }
    }
    await syncPrimaryOwner(db, membership.orgId);
  }
  // Keep the row (versions, usage and events reference it) but drop the personal data.
  if (user) await db.update(users).set({ email: null }).where(eq(users.id, userId));
  return { organizations: memberships.length };
}

export { recordOrgEvent };
