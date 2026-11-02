/** Prefixed random id, e.g. `site_3f2a...`. Prefixes make ids self-describing in logs. */
export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}
