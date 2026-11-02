import { fitWithin, slugify } from "./files";

export const MAX_IMAGE_SIDE = 1600;
export const WEBP_QUALITY = 0.85;

export interface ProcessedImage {
  blob: Blob;
  fileName: string;
  width: number;
  height: number;
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/** Resizes an image file to at most 1600 px on the long side and encodes it as WebP. */
export async function resizeToWebp(file: File): Promise<ProcessedImage> {
  if (!file.type.startsWith("image/")) throw new Error("Please choose an image file.");

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("This image could not be read. Try a JPEG, PNG or WebP file.");
  }

  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height, MAX_IMAGE_SIDE);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Image processing is not available in this browser.");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, width, height);

    const blob = await toBlob(canvas, "image/webp", WEBP_QUALITY);
    if (!blob) throw new Error("This browser could not encode the image.");
    // Browsers without WebP encoding silently fall back to PNG; keep the extension honest.
    const ext = blob.type === "image/webp" ? "webp" : blob.type === "image/png" ? "png" : "img";
    const stem = slugify(file.name.replace(/\.[^.]+$/, "")) || "image";
    return { blob, fileName: `${stem}.${ext}`, width, height };
  } finally {
    bitmap.close();
  }
}
