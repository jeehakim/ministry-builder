import type { EmailMessage } from "./sender";

export interface InvitationEmail {
  to: string;
  orgName: string;
  role: string;
  /** The inviter's sign-in email, or null when unknown (staff automation). */
  inviterEmail: string | null;
  link: string;
  expiresAt: Date;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** The email an invitee receives. Organization names are user text: escaped in HTML, collapsed in the subject. */
export function invitationEmail(inv: InvitationEmail): EmailMessage {
  const intro = inv.inviterEmail ? `${inv.inviterEmail} invited you` : "You have been invited";
  const expires = inv.expiresAt.toISOString().slice(0, 10);
  const text = `${intro} to join ${inv.orgName} on Ministry Sites as ${inv.role}.\n\nOpen this link to accept (sign in with ${inv.to}):\n${inv.link}\n\nThe link works until ${expires}. If you were not expecting this, ignore this email.\n`;
  const html = `<!doctype html>
<html><body style="font-family:system-ui,sans-serif;line-height:1.5;color:#1a1a1a">
<p>${escapeHtml(intro)} to join <strong>${escapeHtml(inv.orgName)}</strong> on Ministry Sites as <strong>${escapeHtml(inv.role)}</strong>.</p>
<p><a href="${escapeHtml(inv.link)}" style="display:inline-block;padding:10px 16px;background:#1a1a1a;color:#fff;border-radius:8px;text-decoration:none">Accept the invitation</a></p>
<p style="color:#666">Sign in with ${escapeHtml(inv.to)}. The link works until ${expires}. If you were not expecting this, ignore this email.</p>
</body></html>
`;
  return { to: inv.to, subject: `Join ${oneLine(inv.orgName)} on Ministry Sites`, text, html };
}
