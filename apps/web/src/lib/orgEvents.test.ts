import { test } from "node:test";
import assert from "node:assert/strict";
import { ORG_EVENT_ACTIONS, type OrgEvent } from "@ministry/schema";
import { describeOrgEvent, eventActor } from "./orgEvents.ts";

function event(action: OrgEvent["action"], over: Partial<OrgEvent> = {}): OrgEvent {
  return { id: "evt_1", action, actorUserId: "user_1", actorEmail: "pastor@grace.org", target: null, detail: null, createdAt: "2026-11-02T12:00:00Z", ...over };
}

test("describes a role change with the old and new role", () => {
  const e = event("member.role_changed", { detail: { email: "sam@grace.org", from: "editor", to: "admin" } });
  assert.equal(describeOrgEvent(e), "Changed sam@grace.org from editor to admin");
});

test("a role change without the old role still reads well", () => {
  assert.equal(describeOrgEvent(event("member.role_changed", { detail: { email: "sam@grace.org", to: "viewer" } })), "Changed sam@grace.org to viewer");
  assert.equal(describeOrgEvent(event("member.role_changed")), "Changed the role of a member");
});

test("describes invitations, joins and removals", () => {
  assert.equal(describeOrgEvent(event("member.invited", { detail: { email: "new@grace.org", role: "editor" } })), "Invited new@grace.org as editor");
  assert.equal(describeOrgEvent(event("member.joined", { detail: { email: "new@grace.org", role: "editor" } })), "new@grace.org joined as editor");
  assert.equal(describeOrgEvent(event("member.removed", { detail: { email: "old@grace.org" } })), "Removed old@grace.org");
  assert.equal(describeOrgEvent(event("invitation.revoked", { detail: { email: "late@grace.org" } })), "Cancelled the invitation for late@grace.org");
});

test("describes ownership, site and domain events", () => {
  assert.equal(describeOrgEvent(event("ownership.transferred", { detail: { email: "sam@grace.org" } })), "Transferred ownership to sam@grace.org");
  assert.equal(describeOrgEvent(event("site.published", { detail: { slug: "grace" } })), "Published grace");
  assert.equal(describeOrgEvent(event("site.unpublished", { target: "site_9" })), "Unpublished site_9");
  assert.equal(describeOrgEvent(event("site.deleted", { detail: { name: "Grace Church" } })), "Deleted Grace Church");
  assert.equal(describeOrgEvent(event("domain.added", { target: "grace.org" })), "Added the domain grace.org");
  assert.equal(describeOrgEvent(event("domain.removed", { detail: { hostname: "www.grace.org" } })), "Removed the domain www.grace.org");
});

test("describes integration events", () => {
  assert.equal(describeOrgEvent(event("integration.connected", { target: "resend" })), "Connected Resend email");
  assert.equal(describeOrgEvent(event("integration.updated", { detail: { provider: "resend" } })), "Updated Resend email");
  assert.equal(describeOrgEvent(event("integration.disconnected")), "Disconnected an integration");
});

test("every audit action has a non-empty sentence, even with no detail", () => {
  for (const action of ORG_EVENT_ACTIONS) {
    const text = describeOrgEvent(event(action));
    assert.ok(text.length > 0, action);
    assert.ok(!text.includes("undefined") && !text.includes("null"), `${action}: ${text}`);
  }
});

test("a detail value that is not text is ignored", () => {
  assert.equal(describeOrgEvent(event("member.removed", { detail: { email: 42 }, target: "user_7" })), "Removed user_7");
});

test("an unknown action from a newer server is still readable", () => {
  const e = { ...event("member.joined"), action: "member.suspended" } as unknown as OrgEvent;
  assert.equal(describeOrgEvent(e), "Member suspended");
});

test("eventActor names the person, the system, or an unknown user", () => {
  assert.equal(eventActor(event("site.published")), "pastor@grace.org");
  assert.equal(eventActor(event("site.published", { actorUserId: null, actorEmail: null })), "System");
  assert.equal(eventActor(event("site.published", { actorEmail: null })), "Unknown user");
});
