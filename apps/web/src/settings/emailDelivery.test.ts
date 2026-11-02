import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkFromAddress,
  checkFromName,
  defaultTestRecipient,
  emailDomain,
  formatKeyHint,
  integrationErrorMessage,
  senderStatus,
  testSentText,
} from "./emailDelivery.ts";

test("senderStatus names each delivery path and explains it", () => {
  assert.equal(senderStatus("platform").title, "Ministry Sites (default)");
  assert.equal(senderStatus("organization").title, "Your Resend account");
  assert.equal(senderStatus("none").title, "Nothing yet (stored in your inbox only)");
  for (const s of ["platform", "organization", "none"] as const) assert.ok(senderStatus(s).detail.length > 20);
});

test("formatKeyHint shows the last four characters with one ellipsis", () => {
  assert.equal(formatKeyHint("…k4Q2"), "Key ending in …k4Q2");
  assert.equal(formatKeyHint("k4Q2"), "Key ending in …k4Q2");
  assert.equal(formatKeyHint("...k4Q2"), "Key ending in …k4Q2");
  assert.equal(formatKeyHint("  …k4Q2  "), "Key ending in …k4Q2");
  assert.equal(formatKeyHint("re_abcdefgh_k4Q2"), "Key ending in …k4Q2");
  assert.equal(formatKeyHint(""), "Key saved");
});

test("emailDomain lowercases the part after the last @", () => {
  assert.equal(emailDomain("Hello@Mail.Church.ORG"), "mail.church.org");
  assert.equal(emailDomain(" a@b.co "), "b.co");
  assert.equal(emailDomain("no-at-sign"), null);
  assert.equal(emailDomain("trailing@"), null);
  assert.equal(emailDomain("@leading.org"), null);
});

test("checkFromAddress accepts an address on a verified domain, ignoring case", () => {
  assert.deepEqual(checkFromAddress("hello@mail.church.org", ["mail.church.org"]), { ok: true });
  assert.deepEqual(checkFromAddress("Hello@MAIL.Church.org", ["Mail.Church.Org", "other.org"]), { ok: true });
});

test("checkFromAddress rejects an address outside the verified domains and names them", () => {
  const result = checkFromAddress("hello@gmail.com", ["mail.church.org", "church.org"]);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.message, /gmail\.com/);
    assert.match(result.message, /mail\.church\.org, church\.org/);
  }
});

test("checkFromAddress does not treat a subdomain or lookalike as verified", () => {
  assert.equal(checkFromAddress("a@sub.church.org", ["church.org"]).ok, false);
  assert.equal(checkFromAddress("a@church.org.evil.com", ["church.org"]).ok, false);
  assert.equal(checkFromAddress("a@xchurch.org", ["church.org"]).ok, false);
});

test("checkFromAddress asks for a valid address, and for a verified domain when there is none", () => {
  const empty = checkFromAddress("", ["church.org"]);
  assert.equal(empty.ok, false);
  const bad = checkFromAddress("not-an-email", ["church.org"]);
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.match(bad.message, /email address/i);
  const none = checkFromAddress("a@church.org", []);
  assert.equal(none.ok, false);
  if (!none.ok) assert.match(none.message, /verif/i);
});

test("checkFromName allows plain names and rejects characters that break the From header", () => {
  assert.deepEqual(checkFromName(""), { ok: true });
  assert.deepEqual(checkFromName("Grace Church, Austin"), { ok: true });
  assert.equal(checkFromName("Grace <evil@x.com>").ok, false);
  assert.equal(checkFromName("Grace\r\nBcc: a@b.c").ok, false);
  assert.equal(checkFromName("x".repeat(81)).ok, false);
  assert.deepEqual(checkFromName("x".repeat(80)), { ok: true });
});

test("testSentText reads as a relative time and falls back when the time is unreadable", () => {
  const now = Date.parse("2026-11-02T12:00:00Z");
  assert.equal(testSentText("2026-11-02T11:59:50Z", now), "Test sent just now");
  assert.equal(testSentText("2026-11-02T11:55:00Z", now), "Test sent 5 minutes ago");
  assert.equal(testSentText("garbage", now), "Test sent");
});

test("defaultTestRecipient shows the contact email until the user types, and respects an emptied field", () => {
  assert.equal(defaultTestRecipient("typed@x.org", "contact@x.org"), "typed@x.org");
  assert.equal(defaultTestRecipient(null, "contact@x.org"), "contact@x.org");
  assert.equal(defaultTestRecipient("", "contact@x.org"), "");
  assert.equal(defaultTestRecipient(null, null), "");
});

test("integrationErrorMessage uses fixed wording for 429 and 503, and the server's text otherwise", () => {
  assert.equal(integrationErrorMessage({ status: 429, message: "slow down" }), "Too many attempts, try again in an hour");
  assert.equal(integrationErrorMessage({ status: 503, message: "x" }), "Bring-your-own email is not enabled on this server");
  assert.equal(integrationErrorMessage({ status: 400, message: "Resend rejected that key." }), "Resend rejected that key.");
  assert.equal(integrationErrorMessage(new Error("boom")), "boom");
  assert.equal(integrationErrorMessage("nope"), "Something went wrong.");
});
