import type { Bindings } from "./types";

const MB = 1024 * 1024;

export const DEFAULT_MAX_SITES_PER_USER = 10;
export const DEFAULT_MAX_SITE_STORAGE_BYTES = 100 * MB;
export const DEFAULT_MAX_VERSIONS_PER_SITE = 500;
export const DEFAULT_MAX_PUBLISHES_PER_HOUR = 20;
export const DEFAULT_MAX_DOMAINS_PER_SITE = 3;
export const DEFAULT_MAX_DOMAINS_PER_USER = 10;
/** Versions that pruning never touches, besides the current one. */
export const PROTECTED_RECENT_VERSIONS = 50;
export const PUBLISH_WINDOW_MS = 60 * 60 * 1000;

function positiveInt(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export type Limits = {
  maxSitesPerUser: number;
  maxSiteStorageBytes: number;
  maxVersionsPerSite: number;
  maxPublishesPerHour: number;
  maxDomainsPerSite: number;
  maxDomainsPerUser: number;
};

/** Per-user and per-site limits from the environment. A missing, zero or malformed value falls back to the default. */
export function limitsFor(
  env: Pick<
    Bindings,
    "MAX_SITES_PER_USER" | "MAX_SITE_STORAGE_BYTES" | "MAX_VERSIONS_PER_SITE" | "MAX_PUBLISHES_PER_HOUR" | "MAX_DOMAINS_PER_SITE" | "MAX_DOMAINS_PER_USER"
  >,
): Limits {
  return {
    maxSitesPerUser: positiveInt(env.MAX_SITES_PER_USER, DEFAULT_MAX_SITES_PER_USER),
    maxSiteStorageBytes: positiveInt(env.MAX_SITE_STORAGE_BYTES, DEFAULT_MAX_SITE_STORAGE_BYTES),
    maxVersionsPerSite: positiveInt(env.MAX_VERSIONS_PER_SITE, DEFAULT_MAX_VERSIONS_PER_SITE),
    maxPublishesPerHour: positiveInt(env.MAX_PUBLISHES_PER_HOUR, DEFAULT_MAX_PUBLISHES_PER_HOUR),
    maxDomainsPerSite: positiveInt(env.MAX_DOMAINS_PER_SITE, DEFAULT_MAX_DOMAINS_PER_SITE),
    maxDomainsPerUser: positiveInt(env.MAX_DOMAINS_PER_USER, DEFAULT_MAX_DOMAINS_PER_USER),
  };
}
