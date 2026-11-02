import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildCsp, CSP_DIRECTIVES, parseHeadersFile } from "./csp.ts";

const headersText = readFileSync(new URL("../../public/_headers", import.meta.url), "utf8");
const rules = parseHeadersFile(headersText);

test("buildCsp joins directives with semicolons and keeps valueless directives bare", () => {
  assert.equal(buildCsp({ "default-src": ["'self'"], "img-src": ["'self'", "data:"], "upgrade-insecure-requests": [] }), "default-src 'self'; img-src 'self' data:; upgrade-insecure-requests");
});

test("buildCsp rejects values that could inject another directive or header", () => {
  assert.throws(() => buildCsp({ "script-src": ["'self'; script-src *"] }));
  assert.throws(() => buildCsp({ "script-src": ["a b"] }));
  assert.throws(() => buildCsp({ "script-src": ["a\r\nSet-Cookie: x=1"] }));
  assert.throws(() => buildCsp({ "script-src": [""] }));
  assert.throws(() => buildCsp({ "Bad Name": ["'self'"] }));
});

test("public/_headers carries exactly the policy built from CSP_DIRECTIVES", () => {
  assert.equal(rules.get("/*")?.get("content-security-policy"), buildCsp(CSP_DIRECTIVES));
});

test("scripts and framing are locked down", () => {
  assert.ok(!CSP_DIRECTIVES["script-src"]?.includes("'unsafe-inline'"), "script-src must not allow inline scripts");
  assert.ok(!CSP_DIRECTIVES["script-src"]?.includes("'unsafe-eval'"), "script-src must not allow eval");
  assert.deepEqual(CSP_DIRECTIVES["frame-ancestors"], ["'none'"]);
  assert.deepEqual(CSP_DIRECTIVES["default-src"], ["'self'"]);
  assert.ok("upgrade-insecure-requests" in CSP_DIRECTIVES);
  for (const [name, sources] of Object.entries(CSP_DIRECTIVES)) {
    assert.ok(!sources.includes("*"), `${name} must not use a bare wildcard`);
    assert.ok(!sources.includes("http:"), `${name} must not allow plain http`);
  }
});

test("the app can reach the API and Clerk", () => {
  assert.ok(CSP_DIRECTIVES["connect-src"]?.includes("https://api.build.shofar.io"));
  assert.ok(CSP_DIRECTIVES["connect-src"]?.includes("https://clerk.build.shofar.io"));
  assert.ok(CSP_DIRECTIVES["script-src"]?.includes("https://clerk.build.shofar.io"));
});

test("_headers sets the baseline security headers on every path", () => {
  const all = rules.get("/*");
  assert.equal(all?.get("x-content-type-options"), "nosniff");
  assert.equal(all?.get("referrer-policy"), "strict-origin-when-cross-origin");
  assert.equal(all?.get("x-frame-options"), "DENY");
  assert.equal(all?.get("permissions-policy"), "camera=(), microphone=(), geolocation=()");
  assert.equal(all?.get("strict-transport-security"), "max-age=31536000; includeSubDomains");
});

test("_headers caches fingerprinted assets forever and revalidates the entry document", () => {
  assert.equal(rules.get("/assets/*")?.get("cache-control"), "public, max-age=31536000, immutable");
  assert.equal(rules.get("/index.html")?.get("cache-control"), "no-cache");
  assert.equal(rules.get("/")?.get("cache-control"), "no-cache");
});

test("_headers respects Cloudflare's 2000 character line limit", () => {
  for (const line of headersText.split("\n")) assert.ok(line.length <= 2000, `line is ${line.length} characters`);
});

test("parseHeadersFile skips comments and merges repeated patterns", () => {
  const parsed = parseHeadersFile("# note\n/a\n  X-One: 1\n\n/b\n  X-Two: a: b\n/a\n  X-Three: 3\n");
  assert.deepEqual([...(parsed.get("/a") ?? [])], [["x-one", "1"], ["x-three", "3"]]);
  assert.equal(parsed.get("/b")?.get("x-two"), "a: b");
});

test("parseHeadersFile rejects a header with no path above it", () => {
  assert.throws(() => parseHeadersFile("  X-One: 1\n"));
});
