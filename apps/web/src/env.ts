import { resolveDeployment } from "./lib/deployment";

/** Publishable key of the shofar.ai Clerk application in production (see .env.example); empty means local mode. */
export const CLERK_KEY: string = (import.meta.env.VITE_CLERK_PUBLISHABLE_KEY ?? "").trim();
/** Base URL of the API Worker: https://api.build.shofar.ai in production. Must match API_ORIGIN in lib/csp.ts. */
export const API_URL: string = (import.meta.env.VITE_API_URL ?? "http://localhost:8787").replace(/\/+$/, "");

const DEPLOYMENT = resolveDeployment({ prod: import.meta.env.PROD, clerkKey: CLERK_KEY, apiUrl: import.meta.env.VITE_API_URL });

/** Development only: no sign-in, the document lives in localStorage. Never true in a production build. */
export const LOCAL_MODE: boolean = DEPLOYMENT.kind === "local";
/** The names of required build variables a production build lacks, or null when the deployment is usable. */
export const MISSING_CONFIG: string[] | null = DEPLOYMENT.kind === "misconfigured" ? DEPLOYMENT.missing : null;
