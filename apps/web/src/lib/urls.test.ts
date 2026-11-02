import { test } from "node:test";
import assert from "node:assert/strict";
import { assetKeyFromSrc, safeHttpUrl } from "./urls.ts";

test("assetKeyFromSrc strips the /assets/ prefix", () => {
  assert.equal(assetKeyFromSrc("/assets/site1/abc-hero.webp"), "site1/abc-hero.webp");
  assert.equal(assetKeyFromSrc("/assets/abc.webp?v=2#x"), "abc.webp");
});

test("assetKeyFromSrc accepts an absolute API URL", () => {
  assert.equal(assetKeyFromSrc("https://api.build.shofar.ai/assets/s/k.webp"), "s/k.webp");
});

test("assetKeyFromSrc returns null for non-asset sources", () => {
  assert.equal(assetKeyFromSrc("local:123/logo.png"), null);
  assert.equal(assetKeyFromSrc("data:image/gif;base64,AAAA"), null);
  assert.equal(assetKeyFromSrc("images/hero.webp"), null);
  assert.equal(assetKeyFromSrc("/assets/"), null);
  assert.equal(assetKeyFromSrc("https://example.com/other/x.png"), null);
  assert.equal(assetKeyFromSrc(""), null);
});

test("safeHttpUrl only lets http(s) through", () => {
  assert.equal(safeHttpUrl("https://grace.sites.shofar.io"), "https://grace.sites.shofar.io/");
  assert.equal(safeHttpUrl("javascript:alert(1)"), null);
  assert.equal(safeHttpUrl("data:text/html,hi"), null);
  assert.equal(safeHttpUrl("not a url"), null);
  assert.equal(safeHttpUrl(null), null);
  assert.equal(safeHttpUrl(undefined), null);
});
