import { test } from "node:test";
import assert from "node:assert/strict";
import type { OrgSummary } from "@ministry/schema";
import { CURRENT_ORG_KEY, pickCurrentOrg, readRememberedOrgId, rememberOrgId } from "./currentOrg.ts";

const org = (id: string): OrgSummary => ({ id, name: `Org ${id}`, role: "editor", createdAt: "2026-01-01T00:00:00Z" });
const ORGS = [org("a"), org("b"), org("c")];

test("pickCurrentOrg keeps the remembered organization", () => {
  assert.equal(pickCurrentOrg(ORGS, "b")?.id, "b");
});

test("pickCurrentOrg falls back to the first when the remembered one is gone or never set", () => {
  assert.equal(pickCurrentOrg(ORGS, "zzz")?.id, "a");
  assert.equal(pickCurrentOrg(ORGS, null)?.id, "a");
});

test("pickCurrentOrg is null with no organizations", () => {
  assert.equal(pickCurrentOrg([], "a"), null);
});

test("remembering round-trips through storage", () => {
  const data = new Map<string, string>();
  const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
  assert.equal(readRememberedOrgId(storage), null);
  rememberOrgId(storage, "b");
  assert.equal(data.get(CURRENT_ORG_KEY), "b");
  assert.equal(readRememberedOrgId(storage), "b");
});

test("blocked or missing storage never throws", () => {
  const blocked = {
    getItem: () => {
      throw new Error("SecurityError");
    },
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
  };
  assert.equal(readRememberedOrgId(blocked), null);
  assert.doesNotThrow(() => rememberOrgId(blocked, "a"));
  assert.equal(readRememberedOrgId(undefined), null);
  assert.doesNotThrow(() => rememberOrgId(undefined, "a"));
});
