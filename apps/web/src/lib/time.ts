const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "just now", "5 minutes ago", "3 days ago". Empty string for an unparseable timestamp. */
export function formatRelativeTime(iso: string, now: number = Date.now(), locale = "en"): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const diff = now - then;
  if (diff < 45_000) return "just now";

  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "always" });
  if (diff < HOUR) return rtf.format(-Math.max(1, Math.round(diff / MINUTE)), "minute");
  if (diff < DAY) return rtf.format(-Math.round(diff / HOUR), "hour");
  if (diff < 30 * DAY) return rtf.format(-Math.round(diff / DAY), "day");
  if (diff < 365 * DAY) return rtf.format(-Math.round(diff / (30 * DAY)), "month");
  return rtf.format(-Math.round(diff / (365 * DAY)), "year");
}

/** Local wall-clock time such as "5:00 PM" for a quota reset. Empty string when unparseable. */
export function formatClockTime(iso: string, locale?: string, timeZone?: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit", timeZone });
}
