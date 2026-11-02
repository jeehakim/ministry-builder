import { useCallback, useState } from "react";
import { useBackend } from "../backend-context";
import { useSiteId } from "../editor/EditorContext";
import { resizeToWebp } from "./image";

export interface UploadedImage {
  /** Value for `ImageRef.src`. */
  src: string;
  width: number;
  height: number;
}

/** Resize in the browser, then store through the backend. Shared by every image picker. */
export function useImageUpload() {
  const backend = useBackend();
  const siteId = useSiteId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = useCallback(
    async (file: File): Promise<UploadedImage | null> => {
      if (!file.type.startsWith("image/")) {
        setError("Please choose an image file.");
        return null;
      }
      setBusy(true);
      setError(null);
      try {
        const processed = await resizeToWebp(file);
        const src = await backend.uploadImage(siteId, processed.blob, processed.fileName);
        return { src, width: processed.width, height: processed.height };
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload failed.");
        return null;
      } finally {
        setBusy(false);
      }
    },
    [backend, siteId],
  );

  return { upload, busy, error };
}
