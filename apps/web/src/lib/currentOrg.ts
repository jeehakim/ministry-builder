import type { OrgSummary } from "@ministry/schema";

/** localStorage key for the organization the user last chose. */
export const CURRENT_ORG_KEY = "ministry.currentOrgId";

type ReadableStorage = Pick<Storage, "getItem">;
type WritableStorage = Pick<Storage, "setItem">;

/** The organization to show: the remembered one if the user still belongs to it, otherwise the first. Null when they have none. */
export function pickCurrentOrg(orgs: readonly OrgSummary[], preferredId: string | null): OrgSummary | null {
  return orgs.find((o) => o.id === preferredId) ?? orgs[0] ?? null;
}

/** Storage can be missing, full or blocked (private mode); none of that may break the app. */
export function readRememberedOrgId(storage: ReadableStorage | undefined): string | null {
  try {
    const value = storage?.getItem(CURRENT_ORG_KEY);
    return value ? value : null;
  } catch {
    return null;
  }
}

export function rememberOrgId(storage: WritableStorage | undefined, id: string): void {
  try {
    storage?.setItem(CURRENT_ORG_KEY, id);
  } catch {
    // Not remembered; the choice still holds for this session.
  }
}

/** The browser's localStorage, or undefined where touching it throws. */
export function browserStorage(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}
