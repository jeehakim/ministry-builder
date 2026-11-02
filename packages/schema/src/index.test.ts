import { test } from "node:test";
import assert from "node:assert/strict";
import { emptySiteDocument, parseSiteDocument, newSectionId } from "./index.ts";

test("empty document parses and has defaults", () => {
  const doc = emptySiteDocument("Shofar");
  assert.equal(doc.meta.orgName, "Shofar");
  assert.equal(doc.theme.templateId, "classic");
  assert.ok(doc.sections.length >= 5);
  assert.equal(doc.sections[0]?.type, "hero");
});

test("invalid section type is rejected", () => {
  assert.throws(() =>
    parseSiteDocument({ meta: { orgName: "x" }, sections: [{ id: "a", type: "nope" }] }),
  );
});

test("newSectionId avoids collisions", () => {
  const doc = emptySiteDocument();
  assert.equal(newSectionId("about", doc.sections), "about-1");
  const withOne = [...doc.sections, { id: "about-1", type: "about" as const, hidden: false, heading: "x", body: "y" }];
  assert.equal(newSectionId("about", withOne), "about-2");
});
