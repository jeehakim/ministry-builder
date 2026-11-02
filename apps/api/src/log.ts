import type { Context } from "hono";
import type { AppEnv } from "./types";

const MAX_LOG_TEXT = 300;

/** Patterns that must never reach a log line, even inside an upstream error message. */
const REDACTIONS: [RegExp, string][] = [
  [/eyJ[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+){1,2}/g, "[token]"],
  [/Bearer\s+\S+/gi, "Bearer [redacted]"],
  [/\b(?:sk|pk|rk|re|whsec)[-_][A-Za-z0-9_-]{16,}/g, "[key]"],
  [/[^\s@<>()",;:]+@[^\s@<>()",;]+/g, "[email]"],
];

/** Truncates free text for a log line and masks tokens, API keys and email addresses in it. */
export function scrub(text: string, max: number = MAX_LOG_TEXT): string {
  let out = text;
  for (const [pattern, replacement] of REDACTIONS) out = out.replace(pattern, replacement);
  return out.length > max ? `${out.slice(0, max)}…` : out;
}

/** Cloudflare's ray id when present (it ties the log line to the edge request), else a fresh UUID. */
export function requestIdFor(request: Request): string {
  return request.headers.get("cf-ray") || crypto.randomUUID();
}

/** The request id set by the request-context middleware; computed on the spot where that middleware is not mounted. */
export function requestIdOf(c: Context<AppEnv>): string {
  return c.get("requestId") ?? requestIdFor(c.req.raw);
}

/**
 * The loggable parts of an error: its class, an HTTP status when it carries one, and a scrubbed message.
 * Upstream SDK errors can echo request content in their message, so callers pass `withMessage: false` for those.
 */
export function errorFields(err: unknown, withMessage = true): Record<string, string | number> {
  if (!(err instanceof Error)) return { error_name: typeof err };
  const status = (err as { status?: unknown }).status;
  return {
    error_name: err.name,
    ...(typeof status === "number" ? { status } : {}),
    ...(withMessage ? { error_message: scrub(err.message) } : {}),
  };
}

/** One structured error line. Fields must already be safe: ids, counts and `scrub`bed text, never documents or request bodies. */
export function logError(event: string, requestId: string | undefined, fields: Record<string, unknown> = {}): void {
  console.error(JSON.stringify({ event, request_id: requestId, ...fields }));
}
