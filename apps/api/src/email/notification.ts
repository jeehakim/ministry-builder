import type { EmailMessage } from "./sender";

export interface ContactNotification {
  orgName: string;
  name: string;
  email: string;
  message: string;
  language: string;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

/** Collapses anything that could break out of a header line. */
function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** The email the site owner receives. Visitor-supplied text is data: escaped in HTML, never interpolated into markup. */
export function contactNotification(n: ContactNotification, to: string): EmailMessage {
  const text = `${n.name} <${n.email}> wrote via the ${n.orgName} website (${n.language}):\n\n${n.message}\n\nReply to this email to answer ${n.name}.\n`;
  const html = `<!doctype html>
<html><body style="font-family:system-ui,sans-serif;line-height:1.5;color:#1a1a1a">
<p><strong>${escapeHtml(n.name)}</strong> (<a href="mailto:${escapeHtml(n.email)}">${escapeHtml(n.email)}</a>) wrote via the ${escapeHtml(n.orgName)} website (${escapeHtml(n.language)}):</p>
<blockquote style="margin:0;padding:8px 16px;border-left:3px solid #ccc;white-space:pre-wrap">${escapeHtml(n.message)}</blockquote>
<p style="color:#666">Reply to this email to answer ${escapeHtml(n.name)}.</p>
</body></html>
`;
  return {
    to,
    replyTo: n.email,
    subject: `[${oneLine(n.orgName)}] New message from ${oneLine(n.name)}`,
    text,
    html,
  };
}
