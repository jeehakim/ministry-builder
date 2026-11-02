import type { SiteDocument } from "@ministry/schema";

/** Where hosted sites receive contact form posts. */
export const FORM_HOST = "https://sites.shofar.io";

/** Most messages the inbox asks the API for. */
export const MESSAGES_LIMIT = 50;

/** A contact form submission as the API returns it. */
export interface ContactMessage {
  id: string;
  name: string;
  email: string;
  message: string;
  language: string;
  createdAt: string;
  deliveredAt: string | null;
  deliveryError: string | null;
}

/** The platform endpoint a site's contact form posts to, so a self-hosted copy still delivers messages. */
export function formActionUrl(slug: string): string {
  return `${FORM_HOST}/${encodeURIComponent(slug)}/contact`;
}

/**
 * The address the platform emails contact form messages to: the first contact section with an
 * email. Null when there is none, or when a custom form endpoint takes the posts instead.
 */
export function platformContactEmail(doc: SiteDocument): string | null {
  const section = doc.sections.find((s) => s.type === "contact" && s.email.trim() !== "");
  if (!section || section.type !== "contact") return null;
  if (section.formEndpoint?.trim()) return null;
  return section.email.trim();
}

export interface DeliveryStatus {
  delivered: boolean;
  label: "Delivered" | "Not emailed yet";
  /** Why it was not emailed; shown in a tooltip. Null when delivered. */
  detail: string | null;
}

export function deliveryStatus(m: Pick<ContactMessage, "deliveredAt" | "deliveryError">): DeliveryStatus {
  if (m.deliveredAt) return { delivered: true, label: "Delivered", detail: null };
  const error = m.deliveryError?.trim();
  return { delivered: false, label: "Not emailed yet", detail: error || "Email delivery has not happened yet. The message is saved here." };
}

/** A mailto: link that replies to the sender. Returns null when the sender's address looks unusable. */
export function replyMailto(m: Pick<ContactMessage, "email">, orgName: string): string | null {
  const email = m.email.trim();
  if (!/^[^\s@<>,;?&=]+@[^\s@<>,;?&=]+$/.test(email)) return null;
  const subject = `Re: your message to ${orgName}`;
  return `mailto:${encodeURIComponent(email).replace(/%40/g, "@")}?subject=${encodeURIComponent(subject)}`;
}

export function emptyMessagesText(contactEmail: string | null): string {
  return contactEmail
    ? `No messages yet. The contact form on your published site sends them here and to ${contactEmail}.`
    : "No messages yet. The contact form on your published site sends them here.";
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

/** Validates one API entry; null for anything malformed so a bad row cannot break the inbox. */
export function toContactMessage(raw: unknown): ContactMessage | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id);
  const createdAt = str(r.createdAt);
  if (!id || createdAt === null) return null;
  return {
    id,
    name: str(r.name) ?? "",
    email: str(r.email) ?? "",
    message: str(r.message) ?? "",
    language: str(r.language) ?? "",
    createdAt,
    deliveredAt: str(r.deliveredAt),
    deliveryError: str(r.deliveryError),
  };
}

/** Parses the `{ messages: [...] }` envelope, or null when its shape is wrong. */
export function parseMessagesResponse(body: unknown): ContactMessage[] | null {
  if (typeof body !== "object" || body === null || !("messages" in body) || !Array.isArray(body.messages)) return null;
  return body.messages.flatMap((m: unknown) => {
    const parsed = toContactMessage(m);
    return parsed ? [parsed] : [];
  });
}
