import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAuth } from "@clerk/clerk-react";
import type { OrgSummary } from "@ministry/schema";
import { useBackend } from "../backend-context";
import { browserStorage, pickCurrentOrg, readRememberedOrgId, rememberOrgId } from "../lib/currentOrg";
import { isNetworkError } from "../lib/errors";

export type OrgLoadState = { kind: "loading" } | { kind: "error"; message: string; network: boolean } | { kind: "ready" };

export interface OrgContextValue {
  state: OrgLoadState;
  /** Every organization the caller belongs to. Empty in local mode. */
  orgs: OrgSummary[];
  /** The organization being worked in; null when the caller has none (or in local mode). */
  current: OrgSummary | null;
  /** Switches organization and remembers the choice. An id that has not loaded yet takes effect once it does. */
  select(id: string): void;
  /** Loads the list again, for example after accepting an invitation. */
  refresh(): Promise<void>;
}

/** What components see in local mode and while signed out: no organizations, nothing to load. */
const INERT: OrgContextValue = {
  state: { kind: "ready" },
  orgs: [],
  current: null,
  select: () => {},
  refresh: async () => {},
};

const OrgContext = createContext<OrgContextValue>(INERT);

export function useOrg(): OrgContextValue {
  return useContext(OrgContext);
}

/**
 * Loads the caller's organizations once `enabled` (signed in) and tracks which one is current.
 * Renders children immediately; pages read `state` themselves.
 */
export function OrgProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const backend = useBackend();
  const orgsBackend = enabled ? (backend.orgs ?? null) : null;
  const [state, setState] = useState<OrgLoadState>({ kind: "loading" });
  const [orgs, setOrgs] = useState<OrgSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(() => readRememberedOrgId(browserStorage()));
  // Only the newest response may win, so a slow earlier load cannot overwrite a fresher one.
  const seq = useRef(0);

  const refresh = useCallback(async () => {
    if (!orgsBackend) return;
    const mine = ++seq.current;
    try {
      const list = await orgsBackend.list();
      if (mine !== seq.current) return;
      setOrgs(list);
      setState({ kind: "ready" });
    } catch (err) {
      if (mine !== seq.current) return;
      setState({ kind: "error", message: err instanceof Error ? err.message : "Could not load your organizations.", network: isNetworkError(err) });
    }
  }, [orgsBackend]);

  useEffect(() => {
    if (!orgsBackend) {
      seq.current += 1;
      setOrgs([]);
      setState({ kind: "ready" });
      return;
    }
    setState({ kind: "loading" });
    void refresh();
  }, [orgsBackend, refresh]);

  const select = useCallback((id: string) => {
    setSelectedId(id);
    rememberOrgId(browserStorage(), id);
  }, []);

  const value = useMemo<OrgContextValue>(
    () => ({ state, orgs, current: pickCurrentOrg(orgs, selectedId), select, refresh }),
    [state, orgs, selectedId, select, refresh],
  );

  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>;
}

/** For hosted mode, inside ClerkProvider: organizations load only while someone is signed in. */
export function ClerkOrgProvider({ children }: { children: ReactNode }) {
  const { isSignedIn } = useAuth();
  return <OrgProvider enabled={isSignedIn === true}>{children}</OrgProvider>;
}

/**
 * Keeps the header truthful on a page that belongs to one organization: when the page's
 * organization is one the caller belongs to and is not the current one, make it current.
 */
export function useSyncOrgToPage(orgId: string | null): void {
  const { orgs, current, select } = useOrg();
  useEffect(() => {
    if (orgId && current?.id !== orgId && orgs.some((o) => o.id === orgId)) select(orgId);
  }, [orgId, orgs, current, select]);
}
