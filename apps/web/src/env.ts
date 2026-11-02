import { resolveDeployment } from "./lib/deployment";

export const CLERK_KEY: string = (import.meta.env.VITE_CLERK_PUBLISHABLE_KEY ?? "").trim();
export const API_URL: string = (import.meta.env.VITE_API_URL ?? "http://localhost:8787").replace(/\/+$/, "");

const DEPLOYMENT = resolveDeployment({ prod: import.meta.env.PROD, clerkKey: CLERK_KEY, apiUrl: import.meta.env.VITE_API_URL });

/** Development only: no sign-in, the document lives in localStorage. Never true in a production build. */
export const LOCAL_MODE: boolean = DEPLOYMENT.kind === "local";
/** The names of required build variables a production build lacks, or null when the deployment is usable. */
export const MISSING_CONFIG: string[] | null = DEPLOYMENT.kind === "misconfigured" ? DEPLOYMENT.missing : null;
