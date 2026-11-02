import { createContext, useContext } from "react";

/** The id of the site being edited; image uploads are stored against it. */
const SiteIdContext = createContext<string | null>(null);

export const SiteIdProvider = SiteIdContext.Provider;

export function useSiteId(): string {
  const id = useContext(SiteIdContext);
  if (!id) throw new Error("useSiteId must be used inside SiteIdProvider.");
  return id;
}
