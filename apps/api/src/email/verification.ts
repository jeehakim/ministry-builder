import type { EmailMessage } from "./sender";

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

/** Collapses anything that could break out of a header line. */
function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * The double opt-in email for a contact address. Whoever opens `link` confirms that messages from
 * the organization's website may be delivered to `to`. The organization name is owner-supplied text.
 */
export function contactVerificationEmail(input: { orgName: string; link: string; expiresInDays: number }, to: string): EmailMessage {
  const org = oneLine(input.orgName) || "a Ministry Sites website";
  const text = `Someone building the website for ${org} on Ministry Sites entered this address as the place its contact-form messages should be delivered.

If that is right, open this link to confirm:
${input.link}

The link works for ${input.expiresInDays} days. If you did not expect this email, ignore it: nothing will be sent to you.
`;
  const html = `<!doctype html>
<html><body style="font-family:system-ui,sans-serif;line-height:1.5;color:#1a1a1a">
<p>Someone building the website for <strong>${escapeHtml(org)}</strong> on Ministry Sites entered this address as the place its contact-form messages should be delivered.</p>
<p>If that is right, open this link to confirm:</p>
<p><a href="${escapeHtml(input.link)}">${escapeHtml(input.link)}</a></p>
<p style="color:#666">The link works for ${input.expiresInDays} days. If you did not expect this email, ignore it: nothing will be sent to you.</p>
</body></html>
`;
  return { to, subject: `Confirm the contact address for ${org}`, text, html };
}
