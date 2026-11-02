import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { scrub } from "../src/log";
import { DecryptionError, decryptSecret, encryptSecret, isEncryptionAvailable } from "../src/crypto";

const ORG = "org_1";
const SECRET = "re_Abc12345_SecretValueK4Q2";

describe("secret encryption", () => {
  it("round-trips and produces v1.<iv>.<ciphertext> without the plaintext", async () => {
    const blob = await encryptSecret(env, SECRET, ORG);
    expect(blob).toMatch(/^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+$/);
    expect(blob).not.toContain(SECRET);
    expect(await decryptSecret(env, blob, ORG)).toBe(SECRET);
    // 12-byte IV, plaintext length + 16-byte GCM tag.
    const [, , sealed] = blob.split(".");
    expect(Math.floor(((sealed?.length ?? 0) * 3) / 4)).toBe(SECRET.length + 16);
  });

  it("uses a fresh IV every time", async () => {
    const [a, b] = await Promise.all([encryptSecret(env, SECRET, ORG), encryptSecret(env, SECRET, ORG)]);
    expect(a).not.toBe(b);
  });

  it("fails under a different AAD, so a ciphertext cannot move between organizations", async () => {
    const blob = await encryptSecret(env, SECRET, ORG);
    await expect(decryptSecret(env, blob, "org_2")).rejects.toBeInstanceOf(DecryptionError);
  });

  it("fails when the ciphertext, the tag or the IV is tampered with", async () => {
    const blob = await encryptSecret(env, SECRET, ORG);
    const [version, iv, sealed] = blob.split(".") as [string, string, string];
    const flip = (text: string, at: number) => `${text.slice(0, at)}${text[at] === "A" ? "B" : "A"}${text.slice(at + 1)}`;
    for (const tampered of [
      `${version}.${iv}.${flip(sealed, 0)}`,
      `${version}.${iv}.${flip(sealed, sealed.length - 2)}`,
      `${version}.${flip(iv, 3)}.${sealed}`,
      `${version}.${iv}.${sealed.slice(0, -4)}`,
    ]) {
      await expect(decryptSecret(env, tampered, ORG), tampered).rejects.toBeInstanceOf(DecryptionError);
    }
  });

  it("fails for malformed blobs and unknown versions", async () => {
    const blob = await encryptSecret(env, SECRET, ORG);
    for (const bad of ["", "v1", "v1.a.b.c", blob.replace(/^v1/, "v2"), `v1.${"!".repeat(16)}.abc`, "v1.AAAA.AAAA"]) {
      await expect(decryptSecret(env, bad, ORG), bad).rejects.toBeInstanceOf(DecryptionError);
    }
  });

  it("fails under a different server key", async () => {
    const blob = await encryptSecret(env, SECRET, ORG);
    const other = { INTEGRATIONS_KEY: Buffer.alloc(32, 9).toString("base64") };
    await expect(decryptSecret(other, blob, ORG)).rejects.toBeInstanceOf(DecryptionError);
  });

  it("reports availability only for base64 of exactly 32 bytes, and refuses to encrypt otherwise", async () => {
    expect(isEncryptionAvailable(env)).toBe(true);
    expect(isEncryptionAvailable({})).toBe(false);
    expect(isEncryptionAvailable({ INTEGRATIONS_KEY: "" })).toBe(false);
    expect(isEncryptionAvailable({ INTEGRATIONS_KEY: "not base64 !!" })).toBe(false);
    expect(isEncryptionAvailable({ INTEGRATIONS_KEY: Buffer.alloc(16, 1).toString("base64") })).toBe(false);
    expect(isEncryptionAvailable({ INTEGRATIONS_KEY: Buffer.alloc(33, 1).toString("base64") })).toBe(false);
    await expect(encryptSecret({}, SECRET, ORG)).rejects.toThrow("INTEGRATIONS_KEY");
    await expect(encryptSecret({ INTEGRATIONS_KEY: Buffer.alloc(16, 1).toString("base64") }, SECRET, ORG)).rejects.toThrow("INTEGRATIONS_KEY");
  });
});

describe("log scrubbing", () => {
  it("masks Resend keys, including short ones, inside upstream error text", () => {
    expect(scrub(`Resend said ${SECRET} is bad`)).toBe("Resend said [key] is bad");
    expect(scrub("key re_Abc12345 rejected")).toBe("key [key] rejected");
    expect(scrub("the re_ prefix alone and are_you_sure stay")).toBe("the re_ prefix alone and are_you_sure stay");
  });
});
