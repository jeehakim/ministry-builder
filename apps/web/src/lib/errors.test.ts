import { test } from "node:test";
import assert from "node:assert/strict";
import { formatErrorReport, isNetworkError, makeErrorId } from "./errors.ts";

test("isNetworkError is true only for status 0", () => {
  assert.equal(isNetworkError({ status: 0 }), true);
  assert.equal(isNetworkError(Object.assign(new Error("Could not reach the server."), { status: 0 })), true);
  assert.equal(isNetworkError({ status: 500 }), false);
  assert.equal(isNetworkError({ status: 401 }), false);
  assert.equal(isNetworkError(new Error("boom")), false);
  assert.equal(isNetworkError(null), false);
  assert.equal(isNetworkError("status"), false);
  assert.equal(isNetworkError(undefined), false);
});

test("makeErrorId is 6 readable characters and follows the byte source", () => {
  assert.equal(makeErrorId(() => 0), "AAAAAA");
  assert.match(makeErrorId(() => Math.floor(Math.random() * 256)), /^[A-HJKMNP-Z2-9]{6}$/);
  let n = 0;
  assert.equal(makeErrorId(() => n++).length, 6);
});

test("formatErrorReport has an id, time, page and message but no stack", () => {
  const error = new TypeError("x is not a function");
  const text = formatErrorReport({ id: "ABC234", time: new Date("2026-11-02T10:00:00Z"), path: "/sites/42", error, userAgent: "UA/1.0" });
  assert.equal(text, "Error ID: ABC234\nTime: 2026-11-02T10:00:00.000Z\nPage: /sites/42\nError: TypeError: x is not a function\nBrowser: UA/1.0");
  assert.ok(!text.includes(" at "));
  assert.ok(!text.includes(error.stack ?? "unreachable"));
});

test("formatErrorReport trims long messages and flattens whitespace", () => {
  const text = formatErrorReport({ id: "ABC234", time: new Date(0), path: "/", error: new Error(`a\n\n${"b".repeat(1000)}`), userAgent: "UA" });
  const line = text.split("\n").find((l) => l.startsWith("Error: ")) ?? "";
  assert.ok(line.length <= "Error: Error: ".length + 300);
  assert.ok(!line.includes("\n"));
});

test("formatErrorReport copes with thrown non-errors", () => {
  assert.match(formatErrorReport({ id: "ID", time: new Date(0), path: "/", error: "plain string", userAgent: "UA" }), /Error: NonError: plain string/);
  assert.match(formatErrorReport({ id: "ID", time: new Date(0), path: "/", error: undefined, userAgent: "UA" }), /Error: NonError\n/);
});
