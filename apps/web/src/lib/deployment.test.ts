import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveDeployment } from "./deployment.ts";

const API = "https://api.build.shofar.io";

test("a production build with a Clerk key and API URL uses Clerk", () => {
  assert.deepEqual(resolveDeployment({ prod: true, clerkKey: "pk_live_x", apiUrl: API }), { kind: "clerk" });
});

test("a production build with no Clerk key is misconfigured, never local", () => {
  assert.deepEqual(resolveDeployment({ prod: true, clerkKey: "", apiUrl: API }), { kind: "misconfigured", missing: ["VITE_CLERK_PUBLISHABLE_KEY"] });
  assert.deepEqual(resolveDeployment({ prod: true, clerkKey: "   ", apiUrl: API }), { kind: "misconfigured", missing: ["VITE_CLERK_PUBLISHABLE_KEY"] });
});

test("a production build with no API URL is misconfigured", () => {
  assert.deepEqual(resolveDeployment({ prod: true, clerkKey: "pk_live_x", apiUrl: undefined }), { kind: "misconfigured", missing: ["VITE_API_URL"] });
  assert.deepEqual(resolveDeployment({ prod: true, clerkKey: "", apiUrl: "" }), { kind: "misconfigured", missing: ["VITE_CLERK_PUBLISHABLE_KEY", "VITE_API_URL"] });
});

test("development without a key falls back to local mode", () => {
  assert.deepEqual(resolveDeployment({ prod: false, clerkKey: "", apiUrl: undefined }), { kind: "local" });
});

test("development with a key uses Clerk", () => {
  assert.deepEqual(resolveDeployment({ prod: false, clerkKey: "pk_test_x", apiUrl: undefined }), { kind: "clerk" });
});
