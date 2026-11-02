import { createContext, useContext, useMemo, useRef, type ReactNode } from "react";
import { useAuth } from "@clerk/clerk-react";
import { createApiBackend, createLocalBackend, type Backend } from "./backend";

const BackendContext = createContext<Backend | null>(null);

export function useBackend(): Backend {
  const backend = useContext(BackendContext);
  if (!backend) throw new Error("useBackend must be used inside a backend provider.");
  return backend;
}

export function LocalBackendProvider({ children }: { children: ReactNode }) {
  const backend = useMemo(() => createLocalBackend(), []);
  return <BackendContext.Provider value={backend}>{children}</BackendContext.Provider>;
}

/** Must be rendered inside ClerkProvider. */
export function ApiBackendProvider({ children }: { children: ReactNode }) {
  const { getToken } = useAuth();
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;
  const backend = useMemo(() => createApiBackend(() => getTokenRef.current()), []);
  return <BackendContext.Provider value={backend}>{children}</BackendContext.Provider>;
}
