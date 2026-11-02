import { useCallback, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router";
import { ORG_STORAGE_KEY, orgsFromSites, resolveOrg, type OrgChoice } from "./fundraising";

function remembered(): string | null {
  try {
    return localStorage.getItem(ORG_STORAGE_KEY);
  } catch {
    return null;
  }
}

function remember(id: string): void {
  try {
    localStorage.setItem(ORG_STORAGE_KEY, id);
  } catch {
    // Private mode or a full store: the URL still carries the choice.
  }
}

/**
 * The organization the dashboard shows, chosen from `?org=`, then the one remembered in this
 * browser, then the first. Changing it updates the URL (so links can be shared) and the memory.
 */
export function useDashboardOrg(sites: { orgId: string; orgName: string }[] | null): {
  orgs: OrgChoice[];
  orgId: string | null;
  org: OrgChoice | null;
  setOrgId: (id: string) => void;
} {
  const [params, setParams] = useSearchParams();
  const orgs = useMemo(() => orgsFromSites(sites ?? []), [sites]);
  const requested = params.get("org");
  const orgId = useMemo(() => resolveOrg(orgs, requested, remembered()), [orgs, requested]);

  useEffect(() => {
    if (orgId) remember(orgId);
  }, [orgId]);

  const setOrgId = useCallback(
    (id: string) => {
      remember(id);
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.set("org", id);
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  return { orgs, orgId, org: orgs.find((o) => o.id === orgId) ?? null, setOrgId };
}
