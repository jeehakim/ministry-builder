import { test } from "node:test";
import assert from "node:assert/strict";
import { aiFailureText } from "./aiMessages.ts";

test("a 429 becomes the friendly quota message with a local reset time", () => {
  const text = aiFailureText({ status: 429, message: "quota", resetsAt: "2026-11-03T00:00:00Z" });
  assert.match(text, /^Daily AI limit reached, resets at \d{1,2}:\d{2}/);
});

test("a 429 without a usable reset time still reads well", () => {
  assert.equal(aiFailureText({ status: 429, message: "quota" }), "Daily AI limit reached, try again tomorrow");
  assert.equal(
    aiFailureText({ status: 429, message: "quota", resetsAt: "garbage" }),
    "Daily AI limit reached, try again tomorrow",
  );
});

test("other statuses pass the server message through", () => {
  assert.equal(aiFailureText({ status: 503, message: "AI is not configured." }), "AI is not configured.");
  assert.equal(aiFailureText({ status: 502, message: "The AI provider failed." }), "The AI provider failed.");
  assert.equal(aiFailureText({ status: 0, message: "Could not reach the server." }), "Could not reach the server.");
});
