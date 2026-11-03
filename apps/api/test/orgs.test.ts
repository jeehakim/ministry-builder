import type { OrgRole } from "@ministry/schema";
import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, describe, expect, it, vi } from "vitest";
import { orgInvitations, orgMembers, organizations, users } from "../src/db/schema";
import { hashInvitationToken, invitationLink, maskEmail, newInvitationToken } from "../src/invitations";
import { call, callAs, jsonInit, makeSite, type TestSite } from "./helpers";

afterEach(() => vi.unstubAllGlobals());

const db = () => drizzle(env.DB);

/** Puts a user straight into an organization with a role, as an accepted invitation would. */
async function addMember(orgId: string, userId: string, role: OrgRole, email: string | null = null): Promise<void> {
  await db().insert(users).values({ id: userId, email }).onConflictDoUpdate({ target: users.id, set: { email } });
  await db().insert(orgMembers).values({ orgId, userId, role, invitedBy: null });
}

type Team = { site: TestSite; owner: string; admin: string; editor: string; viewer: string; outsider: string };

/** An organization with one member per role. User ids are unique per call so tests stay independent. */
async function makeTeam(tag: string): Promise<Team> {
  const owner = `${tag}_owner`;
  const site = await makeSite(owner, `${tag} Org`);
  const team = { site, owner, admin: `${tag}_admin`, editor: `${tag}_editor`, viewer: `${tag}_viewer`, outsider: `${tag}_outsider` };
  await addMember(site.orgId, team.admin, "admin", `${team.admin}@example.org`);
  await addMember(site.orgId, team.editor, "editor", `${team.editor}@example.org`);
  await addMember(site.orgId, team.viewer, "viewer", `${team.viewer}@example.org`);
  return team;
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

type MembersBody = { members: { userId: string; role: OrgRole; email: string | null }[]; invitations: { id: string; email: string; role: string }[] };
type InviteBody = { invitation: { id: string; email: string; role: string; expiresAt: string }; delivery: "email" | "link"; link?: string };
type EventsBody = { events: { action: string; actorUserId: string | null; actorEmail: string | null; target: string | null; detail: Record<string, unknown> | null }[] };

async function roleOf(orgId: string, userId: string): Promise<OrgRole | null> {
  const [row] = await db()
    .select({ role: orgMembers.role })
    .from(orgMembers)
    .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, userId)))
    .limit(1);
  return row?.role ?? null;
}

async function primaryOwner(orgId: string): Promise<string | undefined> {
  const [row] = await db().select({ ownerUserId: organizations.ownerUserId }).from(organizations).where(eq(organizations.id, orgId)).limit(1);
  return row?.ownerUserId;
}

async function actions(orgId: string, user: string): Promise<string[]> {
  const body = await json<EventsBody>(await call(user, `/orgs/${orgId}/events`));
  return body.events.map((e) => e.action);
}

describe("invitation helpers", () => {
  it("makes url-safe tokens whose hash is stable hex", async () => {
    const token = newInvitationToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newInvitationToken()).not.toBe(token);
    const hash = await hashInvitationToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashInvitationToken(token)).toBe(hash);
  });

  it("masks addresses and builds links on the web origin", () => {
    expect(maskEmail("jane.doe@example.org")).toBe("j***@example.org");
    expect(maskEmail("nope")).toBe("***");
    expect(invitationLink({ ALLOWED_ORIGIN: "https://build.shofar.ai/" }, "abc")).toBe("https://build.shofar.ai/invite/abc");
  });
});

describe("GET /orgs and membership-scoped listings", () => {
  it("lists the caller's organizations with their role, and sites across or within them", async () => {
    const team = await makeTeam("list");
    const other = await makeSite(team.editor, "Editor Own Org");

    const mine = await json<{ orgs: { id: string; name: string; role: OrgRole }[] }>(await call(team.editor, "/orgs"));
    expect(mine.orgs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: team.site.orgId, name: "list Org", role: "editor" }),
        expect.objectContaining({ id: other.orgId, name: "Editor Own Org", role: "owner" }),
      ]),
    );
    expect(mine.orgs).toHaveLength(2);
    expect((await json<{ orgs: unknown[] }>(await call(team.outsider, "/orgs"))).orgs).toHaveLength(0);

    const all = await json<{ sites: { id: string; orgId: string; role: OrgRole }[] }>(await call(team.editor, "/sites"));
    expect(all.sites.map((s) => s.id).sort()).toEqual([team.site.id, other.id].sort());
    expect(all.sites.find((s) => s.id === team.site.id)?.role).toBe("editor");

    const scoped = await json<{ sites: { id: string }[] }>(await call(team.editor, `/sites?orgId=${team.site.orgId}`));
    expect(scoped.sites.map((s) => s.id)).toEqual([team.site.id]);
    expect((await json<{ sites: unknown[] }>(await call(team.viewer, `/sites?orgId=${other.orgId}`))).sites).toHaveLength(0);
  });

  it("reports the caller's role on a site and 404s for non-members", async () => {
    const team = await makeTeam("role");
    for (const [user, role] of [[team.owner, "owner"], [team.admin, "admin"], [team.editor, "editor"], [team.viewer, "viewer"]] as const) {
      const body = await json<{ site: { role: OrgRole } }>(await call(user, `/sites/${team.site.id}`));
      expect(body.site.role, user).toBe(role);
    }
    expect((await call(team.outsider, `/sites/${team.site.id}`)).status).toBe(404);
    const staff = await json<{ site: { role: OrgRole } }>(await call("role_staff:admin", `/sites/${team.site.id}`));
    expect(staff.site.role).toBe("owner");
  });
});

describe("POST /sites inside an organization", () => {
  it("lets admins and owners add a site, refuses editors, hides the org from outsiders", async () => {
    const team = await makeTeam("addsite");
    const res = await call(team.admin, "/sites", jsonInit("POST", { orgId: team.site.orgId }));
    expect(res.status).toBe(201);
    const body = await json<{ site: { orgId: string }; document: { meta: { orgName: string } } }>(res);
    expect(body.site.orgId).toBe(team.site.orgId);
    expect(body.document.meta.orgName).toBe("addsite Org");

    const named = await call(team.owner, "/sites", jsonInit("POST", { orgId: team.site.orgId, orgName: "Youth Camp" }));
    expect(named.status).toBe(201);
    expect((await json<{ document: { meta: { orgName: string } } }>(named)).document.meta.orgName).toBe("Youth Camp");

    expect((await call(team.editor, "/sites", jsonInit("POST", { orgId: team.site.orgId }))).status).toBe(403);
    expect((await call(team.outsider, "/sites", jsonInit("POST", { orgId: team.site.orgId }))).status).toBe(404);
    expect((await call(team.owner, "/sites", jsonInit("POST", { orgId: 42 }))).status).toBe(400);
    expect((await call(team.owner, "/sites", jsonInit("POST", {}))).status).toBe(400);
  });
});

describe("role matrix on site routes", () => {
  it("viewer: read only; editor: content, publish, messages; admin: domains and integrations; owner: delete", async () => {
    const team = await makeTeam("matrix");
    const site = team.site.id;
    const doc = (await json<{ document: unknown }>(await call(team.viewer, `/sites/${site}`))).document;

    // Reads for everyone.
    for (const user of [team.viewer, team.editor, team.admin, team.owner]) {
      expect((await call(user, `/sites/${site}/versions`)).status, user).toBe(200);
      expect((await call(user, `/sites/${site}/messages`)).status, user).toBe(200);
      expect((await call(user, `/sites/${site}/domains`)).status, user).toBe(200);
      expect((await call(user, `/orgs/${team.site.orgId}/integrations`)).status, user).toBe(200);
    }

    // Content and publishing.
    expect((await call(team.viewer, `/sites/${site}/document`, jsonInit("PUT", doc))).status).toBe(403);
    expect((await call(team.editor, `/sites/${site}/document`, jsonInit("PUT", doc))).status).toBe(200);
    expect((await call(team.viewer, `/sites/${site}/publish`, { method: "POST" })).status).toBe(403);
    expect((await call(team.editor, `/sites/${site}/publish`, { method: "POST" })).status).toBe(200);
    expect((await call(team.viewer, `/sites/${site}/unpublish`, { method: "POST" })).status).toBe(403);
    expect((await call(team.editor, `/sites/${site}/unpublish`, { method: "POST" })).status).toBe(200);
    expect((await call(team.viewer, `/sites/${site}/messages/msg_x`, { method: "DELETE" })).status).toBe(403);
    expect((await call(team.editor, `/sites/${site}/messages/msg_x`, { method: "DELETE" })).status).toBe(404);
    expect((await call(team.viewer, `/sites/${site}/ai/rewrite`, jsonInit("POST", { text: "Hello", instruction: "Warmer" }))).status).toBe(403);
    expect((await call(team.editor, `/sites/${site}/ai/rewrite`, jsonInit("POST", { text: "Hello", instruction: "Warmer" }))).status).toBe(200);

    // Domains and integrations: a bad body answers 400 only once the role check has passed.
    expect((await call(team.editor, `/sites/${site}/domains`, jsonInit("POST", { hostname: "" }))).status).toBe(403);
    expect((await call(team.admin, `/sites/${site}/domains`, jsonInit("POST", { hostname: "" }))).status).toBe(400);
    expect((await call(team.editor, `/orgs/${team.site.orgId}/integrations/resend/key`, jsonInit("PUT", { apiKey: "nope" }))).status).toBe(403);
    expect((await call(team.admin, `/orgs/${team.site.orgId}/integrations/resend/key`, jsonInit("PUT", { apiKey: "nope" }))).status).toBe(400);
    expect((await call(team.editor, `/orgs/${team.site.orgId}/integrations/resend`, { method: "DELETE" })).status).toBe(403);

    // Deleting the site is for owners.
    expect((await call(team.admin, `/sites/${site}`, { method: "DELETE" })).status).toBe(403);
    expect((await call(team.outsider, `/sites/${site}`, { method: "DELETE" })).status).toBe(404);
    expect((await call(team.owner, `/sites/${site}`, { method: "DELETE" })).status).toBe(200);

    // Last site gone: the organization and its memberships went with it.
    expect((await json<{ orgs: unknown[] }>(await call(team.viewer, "/orgs"))).orgs).toHaveLength(0);
    expect(await roleOf(team.site.orgId, team.owner)).toBeNull();
  });

  it("writes audit events for publish, unpublish and delete", async () => {
    const team = await makeTeam("audit");
    expect((await call(team.editor, `/sites/${team.site.id}/publish`, { method: "POST" })).status).toBe(200);
    expect((await call(team.editor, `/sites/${team.site.id}/unpublish`, { method: "POST" })).status).toBe(200);
    const events = await json<EventsBody>(await call(team.viewer, `/orgs/${team.site.orgId}/events`));
    expect(events.events.map((e) => e.action)).toEqual(["site.unpublished", "site.published"]);
    expect(events.events[1]).toMatchObject({ actorUserId: team.editor, actorEmail: `${team.editor}@example.org`, target: team.site.id });
    expect(events.events[1]?.detail).toMatchObject({ slug: team.site.slug });
    expect((await call(team.outsider, `/orgs/${team.site.orgId}/events`)).status).toBe(404);
  });
});

describe("members", () => {
  it("lists members for every role; only admins see pending invitations", async () => {
    const team = await makeTeam("members");
    await call(team.admin, `/orgs/${team.site.orgId}/invitations`, jsonInit("POST", { email: "new@example.org", role: "editor" }));

    const asViewer = await json<MembersBody>(await call(team.viewer, `/orgs/${team.site.orgId}/members`));
    expect(asViewer.members.find((m) => m.userId === team.owner)).toMatchObject({ role: "owner", email: null });
    expect(asViewer.members.map((m) => [m.userId, m.role]).sort()).toEqual([
      [team.admin, "admin"],
      [team.editor, "editor"],
      [team.owner, "owner"],
      [team.viewer, "viewer"],
    ]);
    expect(asViewer.invitations).toEqual([]);

    const asAdmin = await json<MembersBody>(await call(team.admin, `/orgs/${team.site.orgId}/members`));
    expect(asAdmin.invitations).toEqual([expect.objectContaining({ email: "new@example.org", role: "editor" })]);
    expect((await call(team.outsider, `/orgs/${team.site.orgId}/members`)).status).toBe(404);
  });

  it("changes roles within the matrix: admins manage non-owners, only owners touch the owner role, never the last owner", async () => {
    const team = await makeTeam("roles");
    const orgId = team.site.orgId;
    const patch = (actor: string, target: string, role: string) => call(actor, `/orgs/${orgId}/members/${target}`, jsonInit("PATCH", { role }));

    expect((await patch(team.editor, team.viewer, "editor")).status).toBe(403);
    expect((await patch(team.admin, team.viewer, "editor")).status).toBe(200);
    expect(await roleOf(orgId, team.viewer)).toBe("editor");
    expect((await patch(team.admin, team.viewer, "owner")).status).toBe(403);
    expect((await patch(team.admin, team.owner, "admin")).status).toBe(403);
    expect((await patch(team.admin, "nobody", "viewer")).status).toBe(404);
    expect((await patch(team.admin, team.viewer, "boss")).status).toBe(400);

    const lastOwner = await patch(team.owner, team.owner, "admin");
    expect(lastOwner.status).toBe(409);

    expect((await patch(team.owner, team.admin, "owner")).status).toBe(200);
    expect((await patch(team.owner, team.owner, "editor")).status).toBe(200);
    expect(await roleOf(orgId, team.owner)).toBe("editor");
    // The primary owner column follows the remaining owner.
    expect(await primaryOwner(orgId)).toBe(team.admin);

    const log = await actions(orgId, team.viewer);
    expect(log.filter((a) => a === "member.role_changed")).toHaveLength(3);
  });

  it("removes members under the same rules and lets a member leave", async () => {
    const team = await makeTeam("remove");
    const orgId = team.site.orgId;
    const remove = (actor: string, target: string) => call(actor, `/orgs/${orgId}/members/${target}`, { method: "DELETE" });

    expect((await remove(team.editor, team.viewer)).status).toBe(403);
    expect((await remove(team.admin, team.owner)).status).toBe(403);
    expect((await remove(team.owner, team.owner)).status).toBe(409);
    expect((await remove(team.admin, "nobody")).status).toBe(404);
    expect((await remove(team.admin, team.viewer)).status).toBe(200);
    expect(await roleOf(orgId, team.viewer)).toBeNull();
    expect((await call(team.viewer, `/sites/${team.site.id}`)).status).toBe(404);
    // Leaving.
    expect((await remove(team.editor, team.editor)).status).toBe(200);
    expect(await roleOf(orgId, team.editor)).toBeNull();
    expect((await remove(team.admin, team.admin)).status).toBe(200);

    const events = await json<EventsBody>(await call(team.owner, `/orgs/${orgId}/events`));
    expect(events.events.filter((e) => e.action === "member.removed").map((e) => e.detail?.["self"])).toEqual([true, true, false]);
  });

  it("transfers ownership to another member and demotes the previous owner to admin", async () => {
    const team = await makeTeam("transfer");
    const orgId = team.site.orgId;
    const transfer = (actor: string, userId: string) => call(actor, `/orgs/${orgId}/transfer-ownership`, jsonInit("POST", { userId }));

    expect((await transfer(team.admin, team.editor)).status).toBe(403);
    expect((await transfer(team.owner, team.outsider)).status).toBe(404);
    expect((await transfer(team.owner, team.owner)).status).toBe(409);
    expect((await transfer(team.owner, "")).status).toBe(400);

    const res = await transfer(team.owner, team.editor);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ orgId, ownerUserId: team.editor });
    expect(await roleOf(orgId, team.editor)).toBe("owner");
    expect(await roleOf(orgId, team.owner)).toBe("admin");
    expect(await primaryOwner(orgId)).toBe(team.editor);
    expect((await call(team.owner, `/sites/${team.site.id}`, { method: "DELETE" })).status).toBe(403);
    expect((await actions(orgId, team.viewer))[0]).toBe("ownership.transferred");

    // Staff can transfer without being a member and nobody is demoted for it.
    expect((await transfer("transfer_staff:admin", team.admin)).status).toBe(200);
    expect(await roleOf(orgId, team.admin)).toBe("owner");
    expect(await roleOf(orgId, team.editor)).toBe("owner");
  });
});

describe("invitations", () => {
  function inviteBody(email: string, role = "editor") {
    return jsonInit("POST", { email, role });
  }

  it("creates a hashed, expiring invitation and hands back the link when no email sender is configured", async () => {
    const team = await makeTeam("invite");
    const orgId = team.site.orgId;

    expect((await call(team.editor, `/orgs/${orgId}/invitations`, inviteBody("x@example.org"))).status).toBe(403);
    expect((await call(team.admin, `/orgs/${orgId}/invitations`, inviteBody("not-an-email"))).status).toBe(400);
    expect((await call(team.admin, `/orgs/${orgId}/invitations`, jsonInit("POST", { email: "x@example.org", role: "owner" }))).status).toBe(400);
    expect((await call(team.admin, `/orgs/${orgId}/invitations`, inviteBody(`${team.viewer}@example.org`))).status).toBe(409);

    const res = await call(team.admin, `/orgs/${orgId}/invitations`, inviteBody("  Pat.Kim@Example.org ", "viewer"));
    expect(res.status).toBe(201);
    const body = await json<InviteBody>(res);
    expect(body.delivery).toBe("link");
    expect(body.invitation).toMatchObject({ email: "pat.kim@example.org", role: "viewer" });
    expect(body.link).toMatch(new RegExp(`^${env.ALLOWED_ORIGIN}/invite/[A-Za-z0-9_-]{43}$`));
    const token = body.link!.split("/invite/")[1]!;
    const expiresIn = Date.parse(body.invitation.expiresAt) - Date.now();
    expect(expiresIn).toBeGreaterThan(6.9 * 24 * 3600 * 1000);
    expect(expiresIn).toBeLessThanOrEqual(7 * 24 * 3600 * 1000);

    const [stored] = await db().select().from(orgInvitations).where(eq(orgInvitations.id, body.invitation.id));
    expect(stored?.tokenHash).toBe(await hashInvitationToken(token));
    expect(stored?.tokenHash).not.toContain(token);

    // Public preview, no auth.
    const preview = await call(null, `/invitations/${token}`);
    expect(preview.status).toBe(200);
    expect(preview.headers.get("Cache-Control")).toBe("no-store");
    expect(await preview.json()).toEqual({
      orgName: "invite Org",
      role: "viewer",
      inviterEmail: `${team.admin}@example.org`,
      email: "p***@example.org",
      expiresAt: body.invitation.expiresAt,
    });
    expect((await call(null, `/invitations/${token.slice(0, -1)}x`)).status).toBe(404);
    expect((await call(null, "/invitations/short")).status).toBe(404);

    // Re-inviting the same address replaces the pending link.
    const again = await json<InviteBody>(await call(team.admin, `/orgs/${orgId}/invitations`, inviteBody("pat.kim@example.org", "editor")));
    expect((await call(null, `/invitations/${token}`)).status).toBe(404);
    const newToken = again.link!.split("/invite/")[1]!;

    // Accepting needs a signed-in user with the invited address.
    expect((await call(null, `/invitations/${newToken}/accept`, { method: "POST" })).status).toBe(401);
    const wrong = await callAs("invite_wrong", "someone.else@example.org", `/invitations/${newToken}/accept`, { method: "POST" });
    expect(wrong.status).toBe(403);
    expect(await wrong.json()).toMatchObject({ email: "p***@example.org" });
    expect((await call("invite_noemail", `/invitations/${newToken}/accept`, { method: "POST" })).status).toBe(403);

    const accept = await callAs("invite_pat", "Pat.Kim@example.org", `/invitations/${newToken}/accept`, { method: "POST" });
    expect(accept.status).toBe(200);
    expect(await accept.json()).toEqual({ orgId, orgName: "invite Org", role: "editor" });
    expect(await roleOf(orgId, "invite_pat")).toBe("editor");
    expect((await call("invite_pat", `/sites/${team.site.id}`)).status).toBe(200);
    // One-shot.
    expect((await callAs("invite_pat", "pat.kim@example.org", `/invitations/${newToken}/accept`, { method: "POST" })).status).toBe(404);
    expect((await call(null, `/invitations/${newToken}`)).status).toBe(404);

    const log = await actions(orgId, team.viewer);
    expect(log).toEqual(["member.joined", "member.invited", "member.invited"]);
  });

  it("never lowers an existing member's role on accept, revokes pending invitations and caps them per day", async () => {
    const team = await makeTeam("inviterules");
    const orgId = team.site.orgId;
    const invite = (email: string, role = "viewer") => call(team.owner, `/orgs/${orgId}/invitations`, jsonInit("POST", { email, role }));

    // An admin invited as viewer stays admin (the address is not yet linked to a member row, so the invite is allowed).
    const asViewer = await json<InviteBody>(await invite("keep@example.org"));
    await addMember(orgId, "invite_keep", "admin", "keep@example.org");
    const token = asViewer.link!.split("/invite/")[1]!;
    const accepted = await callAs("invite_keep", "keep@example.org", `/invitations/${token}/accept`, { method: "POST" });
    expect(accepted.status).toBe(200);
    expect(await roleOf(orgId, "invite_keep")).toBe("admin");

    // Revoke.
    const pending = await json<InviteBody>(await invite("revoke@example.org"));
    expect((await call(team.editor, `/orgs/${orgId}/invitations/${pending.invitation.id}`, { method: "DELETE" })).status).toBe(403);
    expect((await call(team.admin, `/orgs/${orgId}/invitations/${pending.invitation.id}`, { method: "DELETE" })).status).toBe(200);
    expect((await call(null, `/invitations/${pending.link!.split("/invite/")[1]}`)).status).toBe(404);
    expect((await call(team.admin, `/orgs/${orgId}/invitations/${pending.invitation.id}`, { method: "DELETE" })).status).toBe(404);
    expect((await actions(orgId, team.viewer))[0]).toBe("invitation.revoked");

    // 20 per rolling day, counting the two above (the revoked one included).
    for (let i = 0; i < 18; i++) expect((await invite(`bulk${i}@example.org`)).status, `invite ${i}`).toBe(201);
    const over = await invite("one-too-many@example.org");
    expect(over.status).toBe(429);
    expect(await over.json()).toEqual({ error: "Too many invitations (20 per day). Try again tomorrow.", limit: 20 });
  });

  it("expired invitations are refused and cleaned up", async () => {
    const team = await makeTeam("expired");
    const body = await json<InviteBody>(await call(team.owner, `/orgs/${team.site.orgId}/invitations`, inviteBody("late@example.org")));
    await db().update(orgInvitations).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(orgInvitations.id, body.invitation.id));
    const token = body.link!.split("/invite/")[1]!;
    expect((await call(null, `/invitations/${token}`)).status).toBe(404);
    expect(await db().select().from(orgInvitations).where(eq(orgInvitations.id, body.invitation.id))).toHaveLength(0);
    const members = await json<MembersBody>(await call(team.owner, `/orgs/${team.site.orgId}/members`));
    expect(members.invitations).toEqual([]);
  });

  it("sends the email through the platform sender and rolls back when sending fails", async () => {
    const team = await makeTeam("inviteemail");
    const resend = { ...env, EMAIL_PROVIDER: "resend", RESEND_API_KEY: "re_platform_key_123456", EMAIL_FROM: "Ministry Sites <forms@shofar.io>" };
    const sent: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        sent.push(JSON.parse(String(init?.body)));
        return Response.json({ id: "email_1" });
      }),
    );
    const res = await callAs(team.admin, `${team.admin}@example.org`, `/orgs/${team.site.orgId}/invitations`, inviteBody("mail@example.org", "admin"), resend);
    expect(res.status).toBe(201);
    const body = await json<InviteBody>(res);
    expect(body.delivery).toBe("email");
    expect(body.link).toBeUndefined();
    expect(sent).toHaveLength(1);
    const message = sent[0] as { to: string[]; subject: string; text: string; html: string };
    expect(message.to).toEqual(["mail@example.org"]);
    expect(message.subject).toBe("Join inviteemail Org on Ministry Sites");
    expect(message.text).toContain(`${team.admin}@example.org invited you to join inviteemail Org on Ministry Sites as admin.`);
    const link = message.text.match(/https?:\S+\/invite\/([A-Za-z0-9_-]+)/);
    expect(link).not.toBeNull();
    expect((await call(null, `/invitations/${link![1]}`)).status).toBe(200);

    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 500 })));
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const failed = await call(team.admin, `/orgs/${team.site.orgId}/invitations`, inviteBody("lost@example.org"), resend);
    expect(failed.status).toBe(502);
    errorLog.mockRestore();
    const members = await json<MembersBody>(await call(team.admin, `/orgs/${team.site.orgId}/members`));
    expect(members.invitations.map((i) => i.email)).toEqual(["mail@example.org"]);
  });
});

describe("organization AI quota", () => {
  it("counts every member's calls against the organization limit, after the per-user guard", async () => {
    const team = await makeTeam("quota");
    const site = team.site.id;
    const rewrite = (user: string) => call(user, `/sites/${site}/ai/rewrite`, jsonInit("POST", { text: "Hello", instruction: "Warmer" }));

    // Per-user limit is 4 (vitest config); the organization's is 6.
    for (let i = 0; i < 4; i++) expect((await rewrite(team.editor)).status, `editor call ${i}`).toBe(200);
    const userHit = await rewrite(team.editor);
    expect(userHit.status).toBe(429);
    expect(await userHit.json()).toMatchObject({ scope: "user", used: 4, limit: 4 });

    expect((await rewrite(team.admin)).status).toBe(200);
    expect((await rewrite(team.admin)).status).toBe(200);
    const orgHit = await rewrite(team.admin);
    expect(orgHit.status).toBe(429);
    expect(await orgHit.json()).toMatchObject({ scope: "organization", used: 6, limit: 6 });
    expect((await rewrite(team.owner)).status).toBe(429);

    const usage = await json<{ used: number; organization?: { used: number; limit: number } }>(await call(team.owner, `/ai/usage?orgId=${team.site.orgId}`));
    expect(usage).toMatchObject({ used: 0, organization: { used: 6, limit: 6 } });
    const stranger = await json<{ organization?: unknown }>(await call(team.outsider, `/ai/usage?orgId=${team.site.orgId}`));
    expect(stranger.organization).toBeUndefined();

    // Another organization is unaffected.
    const other = await makeSite("quota_other", "Other Quota Org");
    expect((await call("quota_other", `/sites/${other.id}/ai/rewrite`, jsonInit("POST", { text: "Hello", instruction: "Warmer" }))).status).toBe(200);
  });
});

describe("staff hand-over keeps memberships in step", () => {
  it("makes the Clerk user an owner member and drops the previous owner", async () => {
    const site = await makeSite("handover_builder", "Handover Org");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json([{ id: "handover_pastor" }])));
    const res = await call("handover_staff:admin", `/orgs/${site.orgId}/transfer`, jsonInit("POST", { email: "pastor@example.org" }));
    expect(res.status).toBe(200);
    expect(await roleOf(site.orgId, "handover_pastor")).toBe("owner");
    expect(await roleOf(site.orgId, "handover_builder")).toBeNull();
    expect((await actions(site.orgId, "handover_pastor"))[0]).toBe("ownership.transferred");
    // Members cannot reach the staff route.
    expect((await call("handover_pastor", `/orgs/${site.orgId}/transfer`, jsonInit("POST", { email: "x@example.org" }))).status).toBe(403);
  });
});
