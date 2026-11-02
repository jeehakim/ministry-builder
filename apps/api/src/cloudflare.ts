import { z } from "zod";
import type { Bindings } from "./types";

/**
 * Cloudflare for SaaS custom hostnames on the shofar.io zone. Every customer domain becomes one
 * custom hostname; Cloudflare issues its certificate and routes its traffic to this Worker once the
 * customer's CNAME points at CUSTOM_HOSTNAME_CNAME_TARGET. The one-time zone setup is in README.md.
 */

const API_BASE = "https://api.cloudflare.com/client/v4";
const TIMEOUT_MS = 15_000;

export type CloudflareConfig = Pick<Bindings, "CLOUDFLARE_API_TOKEN" | "CLOUDFLARE_ZONE_ID">;

/** True when both the token and the zone id are set. Domain routes answer 503 otherwise. */
export function isCloudflareConfigured(env: CloudflareConfig): env is Required<CloudflareConfig> {
  return Boolean(env.CLOUDFLARE_API_TOKEN && env.CLOUDFLARE_ZONE_ID);
}

const CustomHostname = z.object({
  id: z.string().min(1),
  hostname: z.string(),
  /** Hostname (ownership) status: "active" once the CNAME points at us. */
  status: z.string().optional(),
  ssl: z
    .object({
      status: z.string().optional(),
    })
    .nullish(),
});

const Envelope = z.object({
  success: z.boolean(),
  errors: z.array(z.object({ code: z.number().optional(), message: z.string() })).default([]),
  result: z.unknown().nullish(),
});

export type CustomHostname = {
  id: string;
  hostname: string;
  /** Hostname verification status as Cloudflare reports it ("pending" until the CNAME is in place). */
  status: string;
  /** Certificate status ("pending_validation", "pending_issuance", "pending_deployment", "active", ...). */
  sslStatus: string;
};

export class CloudflareError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "CloudflareError";
    this.status = status;
  }
}

function toCustomHostname(raw: unknown): CustomHostname {
  const parsed = CustomHostname.safeParse(raw);
  if (!parsed.success) throw new CloudflareError(502, "Cloudflare returned an unexpected custom hostname");
  return {
    id: parsed.data.id,
    hostname: parsed.data.hostname,
    status: parsed.data.status ?? "pending",
    sslStatus: parsed.data.ssl?.status ?? "pending",
  };
}

async function cfRequest(env: Required<CloudflareConfig>, method: string, path: string, body?: unknown): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/zones/${encodeURIComponent(env.CLOUDFLARE_ZONE_ID)}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new CloudflareError(502, `Could not reach Cloudflare: ${err instanceof Error ? err.message : String(err)}`);
  }
  const envelope = Envelope.safeParse(await res.json().catch(() => null));
  if (!envelope.success) throw new CloudflareError(res.status, `Cloudflare answered ${res.status} without a JSON envelope`);
  if (!res.ok || !envelope.data.success) {
    const detail = envelope.data.errors.map((e) => e.message).join("; ") || `status ${res.status}`;
    throw new CloudflareError(res.status, detail);
  }
  return envelope.data.result;
}

/**
 * Registers a custom hostname with HTTP domain validation: once the customer's CNAME is live,
 * Cloudflare validates ownership and issues the certificate without any further action.
 */
export async function createCustomHostname(env: Required<CloudflareConfig>, hostname: string): Promise<CustomHostname> {
  const result = await cfRequest(env, "POST", "/custom_hostnames", {
    hostname,
    ssl: { method: "http", type: "dv", settings: { min_tls_version: "1.2" } },
  });
  return toCustomHostname(result);
}

export async function getCustomHostname(env: Required<CloudflareConfig>, id: string): Promise<CustomHostname> {
  return toCustomHostname(await cfRequest(env, "GET", `/custom_hostnames/${encodeURIComponent(id)}`));
}

/** Removes the custom hostname. A hostname Cloudflare no longer knows counts as removed. */
export async function deleteCustomHostname(env: Required<CloudflareConfig>, id: string): Promise<void> {
  try {
    await cfRequest(env, "DELETE", `/custom_hostnames/${encodeURIComponent(id)}`);
  } catch (err) {
    if (err instanceof CloudflareError && err.status === 404) return;
    throw err;
  }
}
