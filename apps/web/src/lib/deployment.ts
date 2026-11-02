/** What kind of deployment this build is, decided from the build-time environment. Pure, so it can be tested. */
export type DeploymentMode =
  | { kind: "clerk" }
  /** No sign-in: the document lives in this browser's localStorage. Development only. */
  | { kind: "local" }
  /** A production build that lacks required configuration. The app must not start. */
  | { kind: "misconfigured"; missing: string[] };

export interface DeploymentEnv {
  /** `import.meta.env.PROD`. */
  prod: boolean;
  clerkKey: string;
  /** The raw `VITE_API_URL`, before any default is applied. */
  apiUrl: string | undefined;
}

/**
 * Local mode is a development convenience. A production build with no Clerk key (a missing
 * build variable, say) must never fall back to it: that would serve an unauthenticated editor
 * on the production hostname, so it is reported as misconfigured instead.
 */
export function resolveDeployment({ prod, clerkKey, apiUrl }: DeploymentEnv): DeploymentMode {
  if (prod) {
    const missing: string[] = [];
    if (clerkKey.trim() === "") missing.push("VITE_CLERK_PUBLISHABLE_KEY");
    if ((apiUrl ?? "").trim() === "") missing.push("VITE_API_URL");
    return missing.length > 0 ? { kind: "misconfigured", missing } : { kind: "clerk" };
  }
  return clerkKey.trim() === "" ? { kind: "local" } : { kind: "clerk" };
}
