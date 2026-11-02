/**
 * True when a request never got an HTTP response: the network is down, the API is unreachable, or it timed out.
 * `createApiClient` reports these as an error with `status` 0. Duck-typed so this file does not import the API client.
 */
export function isNetworkError(err: unknown): boolean {
  return typeof err === "object" && err !== null && "status" in err && err.status === 0;
}

const ID_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L: easy to read out loud
const ID_LENGTH = 6;
const MESSAGE_LIMIT = 300;

/** A short, readable id for one crash, so a user can quote it to support. `randomByte` returns 0 to 255. */
export function makeErrorId(randomByte: () => number): string {
  let id = "";
  for (let i = 0; i < ID_LENGTH; i++) id += ID_ALPHABET[randomByte() % ID_ALPHABET.length];
  return id;
}

export interface ErrorReport {
  id: string;
  time: Date;
  /** The page path only: no query string or hash, which can carry tokens. */
  path: string;
  error: unknown;
  userAgent: string;
}

/** The text behind "Copy details". Deliberately has no stack trace; the message is trimmed to a safe length. */
export function formatErrorReport({ id, time, path, error, userAgent }: ErrorReport): string {
  const name = error instanceof Error ? error.name : "NonError";
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const message = raw.replace(/\s+/g, " ").trim().slice(0, MESSAGE_LIMIT);
  return [`Error ID: ${id}`, `Time: ${time.toISOString()}`, `Page: ${path}`, `Error: ${name}${message ? `: ${message}` : ""}`, `Browser: ${userAgent}`].join("\n");
}
