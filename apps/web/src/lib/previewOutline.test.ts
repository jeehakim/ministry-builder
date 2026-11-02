import { test } from "node:test";
import assert from "node:assert/strict";
import { proposedOutlineStyle, withProposedOutline } from "./previewOutline.ts";

test("proposedOutlineStyle targets each section id and is empty for none", () => {
  assert.equal(proposedOutlineStyle([]), "");
  const css = proposedOutlineStyle(["hero", "about-1"]);
  assert.match(css, /\[data-section-id="hero"\]/);
  assert.match(css, /\[data-section-id="about-1"\]::after\{content:"Proposed"/);
  assert.match(proposedOutlineStyle(['we"ird']), /\[data-section-id="we\\"ird"\]/);
});

test("withProposedOutline injects before </body> and leaves other HTML alone", () => {
  const html = "<html><body><section data-section-id=\"hero\"></section></body></html>";
  assert.equal(withProposedOutline(html, []), html);
  const out = withProposedOutline(html, ["hero"]);
  assert.ok(out.endsWith("</style></body></html>"));
  assert.ok(withProposedOutline("<p>no body</p>", ["hero"]).endsWith("</style>"));
});
