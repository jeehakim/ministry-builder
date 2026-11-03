import { test } from "node:test";
import assert from "node:assert/strict";
import { isPublicPath } from "./routes.ts";

test("only invitation links are public", () => {
  assert.equal(isPublicPath("/invite/abc123"), true);
  assert.equal(isPublicPath("/invite/abc123/"), true);
  assert.equal(isPublicPath("/"), false);
  assert.equal(isPublicPath("/invite"), false);
  assert.equal(isPublicPath("/invite/"), false);
  assert.equal(isPublicPath("/invite/abc/accept"), false);
  assert.equal(isPublicPath("/invited/abc"), false);
  assert.equal(isPublicPath("/sites/invite/abc"), false);
});
