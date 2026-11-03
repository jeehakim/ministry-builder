import { test } from "node:test";
import assert from "node:assert/strict";
import type { OrgRole } from "@ministry/schema";
import { can, type Action } from "./roles.ts";

const ACTIONS: Action[] = ["edit", "publish", "ai", "manageMembers", "manageDomains", "manageIntegrations", "deleteSite", "transferOwnership", "createSite"];

function allowed(role: OrgRole): Action[] {
  return ACTIONS.filter((a) => can(role, a));
}

test("a viewer can do nothing", () => {
  assert.deepEqual(allowed("viewer"), []);
});

test("an editor edits, publishes and uses AI, and nothing more", () => {
  assert.deepEqual(allowed("editor"), ["edit", "publish", "ai"]);
});

test("an admin adds members, domains, integrations and sites, but cannot delete or transfer", () => {
  assert.deepEqual(allowed("admin"), ["edit", "publish", "ai", "manageMembers", "manageDomains", "manageIntegrations", "createSite"]);
  assert.equal(can("admin", "deleteSite"), false);
  assert.equal(can("admin", "transferOwnership"), false);
});

test("an owner can do everything", () => {
  assert.deepEqual(allowed("owner"), ACTIONS);
});
