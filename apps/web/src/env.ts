export const CLERK_KEY: string = (import.meta.env.VITE_CLERK_PUBLISHABLE_KEY ?? "").trim();
export const LOCAL_MODE: boolean = CLERK_KEY === "";
export const API_URL: string = (import.meta.env.VITE_API_URL ?? "http://localhost:8787").replace(/\/+$/, "");
