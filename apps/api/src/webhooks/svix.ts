/**
 * Verification of Svix-signed webhooks (the scheme Clerk uses). The secret is `whsec_<base64 key>`;
 * the signed content is `<svix-id>.<svix-timestamp>.<raw body>`; the `svix-signature` header carries one or
 * more space-separated `v1,<base64 HMAC-SHA256>` entries (several during a secret rotation).
 * https://docs.svix.com/receiving/verifying-payloads/how-manual
 */

/** Signatures older or newer than this are refused (replay protection). */
export const SVIX_TOLERANCE_MS = 5 * 60 * 1000;

export interface SvixHeaders {
  id: string | undefined;
  timestamp: string | undefined;
  signature: string | undefined;
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> | null {
  try {
    const binary = atob(text);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** True when the body was signed with `secret` for these headers and the timestamp is within tolerance. */
export async function verifySvixSignature(secret: string, headers: SvixHeaders, body: string, now: number = Date.now()): Promise<boolean> {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return false;
  if (!/^\d{1,12}$/.test(timestamp)) return false;
  if (Math.abs(now - Number(timestamp) * 1000) > SVIX_TOLERANCE_MS) return false;

  const keyBytes = fromBase64(secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret);
  if (!keyBytes || keyBytes.length === 0) return false;
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${timestamp}.${body}`)));

  for (const entry of signature.split(" ")) {
    const [version, encoded] = entry.split(",");
    if (version !== "v1" || !encoded) continue;
    const given = fromBase64(encoded);
    if (!given || given.length !== expected.length) continue;
    if (crypto.subtle.timingSafeEqual(given, expected)) return true;
  }
  return false;
}

/** Builds the headers a sender would attach, for tests and local tooling. */
export async function signSvix(secret: string, id: string, timestampSeconds: number, body: string): Promise<SvixHeaders> {
  const keyBytes = fromBase64(secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret) ?? new Uint8Array(1);
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${timestampSeconds}.${body}`)));
  let binary = "";
  for (const b of mac) binary += String.fromCharCode(b);
  return { id, timestamp: String(timestampSeconds), signature: `v1,${btoa(binary)}` };
}
