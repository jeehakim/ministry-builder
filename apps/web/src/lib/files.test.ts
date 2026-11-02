import { test } from "node:test";
import assert from "node:assert/strict";
import { fitWithin, slugify, uniqueFileName } from "./files.ts";

test("fitWithin scales the long side down and never upscales", () => {
  assert.deepEqual(fitWithin(4000, 2000, 1600), { width: 1600, height: 800 });
  assert.deepEqual(fitWithin(2000, 4000, 1600), { width: 800, height: 1600 });
  assert.deepEqual(fitWithin(800, 600, 1600), { width: 800, height: 600 });
  assert.deepEqual(fitWithin(10000, 1, 1600), { width: 1600, height: 1 });
});

test("uniqueFileName takes the basename and falls back to the mime extension", () => {
  const used = new Set<string>();
  assert.equal(uniqueFileName("/assets/site1/hero.webp?x=1", "image/webp", used), "hero.webp");
  assert.equal(uniqueFileName("local:abc/logo", "image/png", used), "logo.png");
});

test("uniqueFileName dedupes and sanitizes", () => {
  const used = new Set<string>();
  assert.equal(uniqueFileName("/a/photo.webp", "image/webp", used), "photo.webp");
  assert.equal(uniqueFileName("/b/photo.webp", "image/webp", used), "photo-2.webp");
  assert.equal(uniqueFileName("/c/my photo!.webp", "image/webp", used), "my_photo_.webp");
});

test("slugify", () => {
  assert.equal(slugify("Grace Community Church!"), "grace-community-church");
  assert.equal(slugify("  "), "site");
});
