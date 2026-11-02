import { test } from "node:test";
import assert from "node:assert/strict";
import type { SiteDocument } from "@ministry/schema";
import {
  deliveryStatus,
  emptyMessagesText,
  formActionUrl,
  parseMessagesResponse,
  platformContactEmail,
  replyMailto,
  toContactMessage,
} from "./messages.ts";

const docWith = (contact: Record<string, unknown>[]) => ({ sections: contact.map((c, i) => ({ id: `c${i}`, type: "contact", ...c })) }) as unknown as SiteDocument;

test("formActionUrl points at the platform endpoint and encodes the slug", () => {
  assert.equal(formActionUrl("grace-church"), "https://sites.shofar.io/grace-church/contact");
  assert.equal(formActionUrl("a b/c"), "https://sites.shofar.io/a%20b%2Fc/contact");
});

test("platformContactEmail finds the first contact section with an email", () => {
  assert.equal(platformContactEmail(docWith([{ email: "" }, { email: " hi@grace.org " }])), "hi@grace.org");
  assert.equal(platformContactEmail(docWith([{ email: "  " }])), null);
  assert.equal(platformContactEmail({ sections: [{ id: "a", type: "about" }] } as unknown as SiteDocument), null);
});

test("platformContactEmail is null when a custom endpoint receives the posts", () => {
  assert.equal(platformContactEmail(docWith([{ email: "hi@grace.org", formEndpoint: "https://api.web3forms.com/submit" }])), null);
  assert.equal(platformContactEmail(docWith([{ email: "hi@grace.org", formEndpoint: "  " }])), "hi@grace.org");
});

test("deliveryStatus", () => {
  assert.deepEqual(deliveryStatus({ deliveredAt: "2026-11-02T10:00:00Z", deliveryError: null }), { delivered: true, label: "Delivered", detail: null });
  const failed = deliveryStatus({ deliveredAt: null, deliveryError: "mailbox full" });
  assert.equal(failed.label, "Not emailed yet");
  assert.equal(failed.detail, "mailbox full");
  assert.match(deliveryStatus({ deliveredAt: null, deliveryError: null }).detail ?? "", /saved here/);
  assert.match(deliveryStatus({ deliveredAt: null, deliveryError: "  " }).detail ?? "", /saved here/);
});

test("replyMailto builds an encoded subject and rejects unusable addresses", () => {
  assert.equal(
    replyMailto({ email: "sam@example.com" }, "Grace & Co"),
    "mailto:sam@example.com?subject=Re%3A%20your%20message%20to%20Grace%20%26%20Co",
  );
  assert.equal(replyMailto({ email: "bad address" }, "Grace"), null);
  assert.equal(replyMailto({ email: "a@b.c?bcc=x@y.z" }, "Grace"), null);
  assert.equal(replyMailto({ email: "" }, "Grace"), null);
});

test("emptyMessagesText mentions the contact email when there is one", () => {
  assert.equal(
    emptyMessagesText("hi@grace.org"),
    "No messages yet. The contact form on your published site sends them here and to hi@grace.org.",
  );
  assert.equal(emptyMessagesText(null), "No messages yet. The contact form on your published site sends them here.");
});

test("toContactMessage and parseMessagesResponse tolerate malformed rows", () => {
  const good = { id: "m1", name: "Sam", email: "s@x.io", message: "Hi", language: "es", createdAt: "2026-11-02T10:00:00Z", deliveredAt: null, deliveryError: "boom" };
  assert.deepEqual(toContactMessage(good), good);
  assert.equal(toContactMessage({ ...good, id: 5 }), null);
  assert.equal(toContactMessage(null), null);
  assert.equal(toContactMessage({ id: "m2", createdAt: "x" })?.name, "");
  assert.deepEqual(parseMessagesResponse({ messages: [good, 7, { nope: true }] }), [good]);
  assert.equal(parseMessagesResponse({ messages: "x" }), null);
  assert.equal(parseMessagesResponse(undefined), null);
});
