/** Characters that could end a quoted display name or start a second header line. */
const UNSAFE_DISPLAY_NAME = /[\u0000-\u001f\u007f<>"\\]/;

/** True when `name` can go inside a quoted From display name unchanged. */
export function isSafeDisplayName(name: string): boolean {
  return !UNSAFE_DISPLAY_NAME.test(name);
}

/** The lowercase domain of an email address, or null when there is no single "@" followed by text. */
export function emailDomain(address: string): string | null {
  const at = address.lastIndexOf("@");
  if (at < 1 || at === address.length - 1 || address.indexOf("@") !== at) return null;
  return address.slice(at + 1).toLowerCase();
}

/** `"Name" <address>` when a display name is set, else the bare address. Unsafe characters are dropped from the name. */
export function formatFrom(address: string, name?: string | null): string {
  const clean = (name ?? "").replace(new RegExp(UNSAFE_DISPLAY_NAME.source, "g"), "").trim();
  return clean ? `"${clean}" <${address}>` : address;
}
