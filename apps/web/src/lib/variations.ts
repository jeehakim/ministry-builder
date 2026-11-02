/** The page is rendered at a desktop viewport, then scaled down into the card. */
export const PREVIEW_FRAME = { width: 1200, height: 1500 } as const;
export const DEFAULT_PREVIEW_SCALE = 0.33;

/** Scale that makes a frame `frameWidth` wide fit a container `containerWidth` wide. */
export function previewScale(containerWidth: number, frameWidth: number = PREVIEW_FRAME.width): number {
  if (!Number.isFinite(containerWidth) || containerWidth <= 0 || frameWidth <= 0) return DEFAULT_PREVIEW_SCALE;
  return Math.min(1, containerWidth / frameWidth);
}

/** The layout box a scaled frame occupies (CSS transforms do not change layout). */
export function scaledSize(
  scale: number,
  frame: { width: number; height: number } = PREVIEW_FRAME,
): { width: number; height: number } {
  return { width: Math.round(frame.width * scale), height: Math.round(frame.height * scale) };
}

const PROGRESS_STEPS = ["Reading your notes…", "Writing the page…"] as const;

/** Messages shown while the draft call runs; the last one stays until the call returns. */
export function progressMessages(variations: 1 | 3): string[] {
  return variations === 3
    ? [...PROGRESS_STEPS, "Trying a second design…", "Trying a third design…", "Almost there, this can take up to 90 seconds…"]
    : [...PROGRESS_STEPS, "Polishing the details…", "Almost there, this can take up to a minute…"];
}

/** Index of the message to show after `elapsedMs`, advancing every `intervalMs` and clamped to the last. */
export function progressIndex(elapsedMs: number, count: number, intervalMs: number): number {
  if (count <= 0 || intervalMs <= 0) return 0;
  return Math.min(count - 1, Math.max(0, Math.floor(elapsedMs / intervalMs)));
}
