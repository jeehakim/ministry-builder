import type { Bindings } from "./types";

/**
 * Encryption at rest for organization secrets (bring-your-own provider keys).
 * AES-256-GCM through WebCrypto. The key is the Worker secret INTEGRATIONS_KEY: base64 of 32 random
 * bytes (`openssl rand -base64 32`). A blob is `v1.<iv>.<ciphertext+tag>`, both parts base64url. The
 * additional authenticated data is the organization id, so a ciphertext copied to another organization's
 * row fails to decrypt.
 */

const VERSION = "v1";
const IV_BYTES = 12;
const KEY_BYTES = 32;

/** Thrown when a blob cannot be decrypted: wrong key, wrong organization, tampering or a malformed value. */
export class DecryptionError extends Error {
  constructor() {
    super("Could not decrypt the stored secret");
    this.name = "DecryptionError";
  }
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const standard = text.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(standard.padEnd(standard.length + ((4 - (standard.length % 4)) % 4), "="));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** The raw key bytes, or null when INTEGRATIONS_KEY is unset or is not base64 of exactly 32 bytes. */
function keyBytes(env: Pick<Bindings, "INTEGRATIONS_KEY">): Uint8Array<ArrayBuffer> | null {
  const raw = env.INTEGRATIONS_KEY?.trim();
  if (!raw) return null;
  try {
    const bytes = fromBase64(raw);
    return bytes.length === KEY_BYTES ? bytes : null;
  } catch {
    return null;
  }
}

/** True when INTEGRATIONS_KEY is set to a usable key. Integration routes answer 503 otherwise. */
export function isEncryptionAvailable(env: Pick<Bindings, "INTEGRATIONS_KEY">): boolean {
  return keyBytes(env) !== null;
}

async function importKey(env: Pick<Bindings, "INTEGRATIONS_KEY">): Promise<CryptoKey> {
  const bytes = keyBytes(env);
  if (!bytes) throw new Error("INTEGRATIONS_KEY is not set to base64 of 32 bytes");
  return crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

/** Encrypts `plaintext`, binding it to `aad` (the organization id). A fresh random IV is used every call. */
export async function encryptSecret(env: Pick<Bindings, "INTEGRATIONS_KEY">, plaintext: string, aad: string): Promise<string> {
  const key = await importKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(aad) },
    key,
    new TextEncoder().encode(plaintext),
  );
  return `${VERSION}.${toBase64Url(iv)}.${toBase64Url(new Uint8Array(sealed))}`;
}

/** Reverses `encryptSecret`. Throws DecryptionError for anything that does not authenticate under this key and `aad`. */
export async function decryptSecret(env: Pick<Bindings, "INTEGRATIONS_KEY">, blob: string, aad: string): Promise<string> {
  const key = await importKey(env);
  const parts = blob.split(".");
  if (parts.length !== 3 || parts[0] !== VERSION) throw new DecryptionError();
  try {
    const iv = fromBase64(parts[1] ?? "");
    const sealed = fromBase64(parts[2] ?? "");
    if (iv.length !== IV_BYTES) throw new DecryptionError();
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(aad) }, key, sealed);
    return new TextDecoder().decode(plain);
  } catch {
    throw new DecryptionError();
  }
}
