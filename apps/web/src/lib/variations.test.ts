import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PREVIEW_SCALE,
  PREVIEW_FRAME,
  previewScale,
  progressIndex,
  progressMessages,
  scaledSize,
} from "./variations.ts";

test("previewScale fits the frame to the container and never upscales", () => {
  assert.equal(previewScale(396), 0.33);
  assert.equal(previewScale(600), 0.5);
  assert.equal(previewScale(5000), 1);
});

test("previewScale falls back to the default for unmeasured containers", () => {
  assert.equal(previewScale(0), DEFAULT_PREVIEW_SCALE);
  assert.equal(previewScale(-5), DEFAULT_PREVIEW_SCALE);
  assert.equal(previewScale(Number.NaN), DEFAULT_PREVIEW_SCALE);
});

test("scaledSize gives the layout box of the scaled frame", () => {
  assert.deepEqual(scaledSize(0.33), { width: 396, height: 495 });
  assert.deepEqual(scaledSize(0.5, { width: 1000, height: 800 }), { width: 500, height: 400 });
  assert.equal(PREVIEW_FRAME.width, 1200);
});

test("progressMessages starts with reading and writing, and mentions designs only for 3 variations", () => {
  const three = progressMessages(3);
  assert.equal(three[0], "Reading your notes…");
  assert.equal(three[1], "Writing the page…");
  assert.ok(three.includes("Trying a second design…"));
  assert.ok(!progressMessages(1).some((m) => m.includes("design")));
});

test("progressIndex advances on the interval and clamps to the last message", () => {
  assert.equal(progressIndex(0, 4, 4000), 0);
  assert.equal(progressIndex(3999, 4, 4000), 0);
  assert.equal(progressIndex(4000, 4, 4000), 1);
  assert.equal(progressIndex(999_999, 4, 4000), 3);
  assert.equal(progressIndex(-10, 4, 4000), 0);
  assert.equal(progressIndex(10, 0, 4000), 0);
});
