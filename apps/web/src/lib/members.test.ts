import { test } from "node:test";
import assert from "node:assert/strict";
import type { OrgMember } from "@ministry/schema";
import { canChangeMember, canGrantRole, memberLabel, sortMembers, transferCandidates } from "./members.ts";

const member = (userId: string, role: OrgMember["role"], joinedAt: string, email: string | null = `${userId}@x.org`): OrgMember => ({
  userId,
  email,
  role,
  invitedBy: null,
  joinedAt,
});

test("memberLabel falls back for members without an email", () => {
  assert.equal(memberLabel({ email: "a@x.org" }), "a@x.org");
  assert.equal(memberLabel({ email: null }), "Unknown user");
});

test("only admins and owners can change members, and only owners can touch an owner", () => {
  assert.equal(canChangeMember("viewer", "viewer"), false);
  assert.equal(canChangeMember("editor", "viewer"), false);
  assert.equal(canChangeMember("admin", "editor"), true);
  assert.equal(canChangeMember("admin", "admin"), true);
  assert.equal(canChangeMember("admin", "owner"), false);
  assert.equal(canChangeMember("owner", "owner"), true);
});

test("only owners can grant ownership", () => {
  assert.equal(canGrantRole("admin", "owner"), false);
  assert.equal(canGrantRole("admin", "admin"), true);
  assert.equal(canGrantRole("owner", "owner"), true);
  assert.equal(canGrantRole("editor", "viewer"), false);
});

test("sortMembers puts owners first and keeps join order within a role", () => {
  const sorted = sortMembers([
    member("v", "viewer", "2026-01-01"),
    member("e2", "editor", "2026-03-01"),
    member("o", "owner", "2026-05-01"),
    member("e1", "editor", "2026-02-01"),
    member("a", "admin", "2026-04-01"),
  ]);
  assert.deepEqual(sorted.map((m) => m.userId), ["o", "a", "e1", "e2", "v"]);
});

test("transferCandidates leaves out the caller", () => {
  const all = [member("me", "owner", "2026-01-01"), member("them", "admin", "2026-02-01")];
  assert.deepEqual(transferCandidates(all, "me").map((m) => m.userId), ["them"]);
  assert.equal(transferCandidates(all, null).length, 2);
});
