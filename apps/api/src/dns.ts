import { z } from "zod";

/**
 * DNS lookups over HTTPS through Cloudflare's public resolver. Used to check the ownership TXT record
 * a customer publishes for a custom domain; a plain `fetch` keeps the Worker free of a DNS library.
 */
const DOH_URL = "https://cloudflare-dns.com/dns-query";
const TIMEOUT_MS = 8_000;
const TXT_TYPE = 16;

const DohAnswer = z.object({
  Answer: z.array(z.object({ type: z.number(), data: z.string() })).optional(),
});

/** Unquotes a TXT rdata as the resolver prints it: one or more `"..."` strings, joined. */
function txtValue(data: string): string {
  const parts = [...data.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => (m[1] ?? "").replace(/\\(.)/g, "$1"));
  return parts.length > 0 ? parts.join("") : data;
}

export class DnsLookupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DnsLookupError";
  }
}

/** The TXT strings published at `name`, trimmed. An empty list when the name has no TXT record (NXDOMAIN or NODATA). */
export async function lookupTxt(name: string): Promise<string[]> {
  const url = `${DOH_URL}?name=${encodeURIComponent(name)}&type=TXT`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: "application/dns-json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    throw new DnsLookupError(`DNS lookup failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!res.ok) throw new DnsLookupError(`DNS resolver answered ${res.status}`);
  const parsed = DohAnswer.safeParse(await res.json().catch(() => null));
  if (!parsed.success) throw new DnsLookupError("DNS resolver sent an unexpected answer");
  return (parsed.data.Answer ?? []).filter((a) => a.type === TXT_TYPE).map((a) => txtValue(a.data).trim());
}
