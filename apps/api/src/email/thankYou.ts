import { formatMoney } from "@ministry/schema";
import type { EmailMessage } from "./sender";

export interface ThankYouEmail {
  orgName: string;
  campaignTitle: string;
  donorName: string;
  amountCents: number;
  currency: string;
  /** The campaign's own message, with `{{name}}` where the donor's name goes. Empty uses the default text. */
  message: string;
  /** Public address of the campaign page, when the site is published. */
  campaignUrl?: string;
  /** Where replies go: the site's contact address, when there is one. */
  replyTo?: string;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** The text with `{{name}}` filled in; a missing name becomes "friend". */
export function fillThankYou(message: string, donorName: string): string {
  const name = oneLine(donorName) || "friend";
  return message.replace(/\{\{\s*name\s*\}\}/g, name);
}

export function defaultThankYouMessage(orgName: string, campaignTitle: string): string {
  return `Dear {{name}},\n\nThank you for your gift to ${campaignTitle}. It goes straight to this work, and we are grateful you are part of it.\n\nWith thanks,\n${orgName}`;
}

/** The email a donor receives after staff record their gift. Donor-supplied text is data: escaped in HTML. */
export function thankYouEmail(input: ThankYouEmail, to: string): EmailMessage {
  const body = fillThankYou(input.message.trim() || defaultThankYouMessage(input.orgName, input.campaignTitle), input.donorName);
  const amount = formatMoney(input.amountCents, input.currency);
  const footerLines = [`Gift recorded: ${amount} to ${oneLine(input.campaignTitle)}.`];
  if (input.campaignUrl) footerLines.push(input.campaignUrl);
  const text = `${body}\n\n--\n${footerLines.join("\n")}\n`;
  const paragraphs = body
    .split(/\n\s*\n/)
    .map((p) => `<p style="white-space:pre-wrap;margin:0 0 1em">${escapeHtml(p.trim())}</p>`)
    .join("\n");
  const html = `<!doctype html>
<html><body style="font-family:system-ui,sans-serif;line-height:1.5;color:#1a1a1a">
${paragraphs}
<p style="color:#666;font-size:.9em;border-top:1px solid #ddd;padding-top:8px">${escapeHtml(footerLines[0] ?? "")}${
    input.campaignUrl ? ` <a href="${escapeHtml(input.campaignUrl)}">${escapeHtml(input.campaignUrl)}</a>` : ""
  }</p>
</body></html>
`;
  return {
    to,
    ...(input.replyTo ? { replyTo: input.replyTo } : {}),
    subject: `Thank you for your gift to ${oneLine(input.campaignTitle)}`,
    text,
    html,
  };
}
