import { test } from "node:test";
import assert from "node:assert/strict";
import { formatClockTime, formatRelativeTime } from "./time.ts";

const NOW = Date.parse("2026-11-02T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

test("formatRelativeTime buckets by magnitude", () => {
  assert.equal(formatRelativeTime(ago(10_000), NOW), "just now");
  assert.equal(formatRelativeTime(ago(60_000), NOW), "1 minute ago");
  assert.equal(formatRelativeTime(ago(5 * 60_000), NOW), "5 minutes ago");
  assert.equal(formatRelativeTime(ago(3 * 3_600_000), NOW), "3 hours ago");
  assert.equal(formatRelativeTime(ago(2 * 86_400_000), NOW), "2 days ago");
  assert.equal(formatRelativeTime(ago(65 * 86_400_000), NOW), "2 months ago");
  assert.equal(formatRelativeTime(ago(800 * 86_400_000), NOW), "2 years ago");
});

test("formatRelativeTime treats a future timestamp (clock skew) as just now", () => {
  assert.equal(formatRelativeTime(new Date(NOW + 5_000).toISOString(), NOW), "just now");
});

test("formatRelativeTime returns an empty string for garbage", () => {
  assert.equal(formatRelativeTime("not a date", NOW), "");
});

test("formatClockTime renders in the requested zone", () => {
  assert.match(formatClockTime("2026-11-03T00:00:00Z", "en-US", "UTC"), /^12:00\sAM$/);
  assert.match(formatClockTime("2026-11-03T00:00:00Z", "en-US", "America/Los_Angeles"), /^4:00\sPM$/);
  assert.equal(formatClockTime("nope"), "");
});
