import type { OrgEvent } from "@ministry/schema";

/** A string field of the event's free-form detail, or null when absent or not text. */
function field(event: OrgEvent, key: string): string | null {
  const value = event.detail?.[key];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/** Who or what the event was about: the first detail field that names it, then the target, then a plain fallback. */
function subject(event: OrgEvent, keys: string[], fallback: string): string {
  for (const key of keys) {
    const value = field(event, key);
    if (value) return value;
  }
  return event.target?.trim() || fallback;
}

/** One readable sentence for an audit entry, without the actor ("Changed j@x.org from editor to admin"). */
export function describeOrgEvent(event: OrgEvent): string {
  switch (event.action) {
    case "member.invited": {
      const who = subject(event, ["email"], "someone");
      const role = field(event, "role");
      return role ? `Invited ${who} as ${role}` : `Invited ${who}`;
    }
    case "member.joined": {
      const role = field(event, "role");
      const who = subject(event, ["email"], "A new member");
      return role ? `${who} joined as ${role}` : `${who} joined`;
    }
    case "member.role_changed": {
      const who = subject(event, ["email"], "a member");
      const from = field(event, "from");
      const to = field(event, "to") ?? field(event, "role");
      if (from && to) return `Changed ${who} from ${from} to ${to}`;
      if (to) return `Changed ${who} to ${to}`;
      return `Changed the role of ${who}`;
    }
    case "member.removed":
      return `Removed ${subject(event, ["email"], "a member")}`;
    case "invitation.revoked":
      return `Cancelled the invitation for ${subject(event, ["email"], "someone")}`;
    case "ownership.transferred": {
      const to = subject(event, ["email", "toEmail"], "another member");
      return `Transferred ownership to ${to}`;
    }
    case "site.published":
      return `Published ${subject(event, ["name", "orgName", "slug"], "a site")}`;
    case "site.unpublished":
      return `Unpublished ${subject(event, ["name", "orgName", "slug"], "a site")}`;
    case "site.deleted":
      return `Deleted ${subject(event, ["name", "orgName", "slug"], "a site")}`;
    case "domain.added":
      return `Added the domain ${subject(event, ["hostname"], "a custom domain")}`;
    case "domain.removed":
      return `Removed the domain ${subject(event, ["hostname"], "a custom domain")}`;
    case "integration.connected":
      return `Connected ${integrationName(event)}`;
    case "integration.updated":
      return `Updated ${integrationName(event)}`;
    case "integration.disconnected":
      return `Disconnected ${integrationName(event)}`;
    default:
      return unknownAction(event.action);
  }
}

function integrationName(event: OrgEvent): string {
  const raw = field(event, "provider") ?? event.target?.trim() ?? "";
  if (raw.toLowerCase() === "resend") return "Resend email";
  return raw || "an integration";
}

/** Stays readable if the server ever sends an action this build does not know ("member.suspended" becomes "Member suspended"). */
function unknownAction(action: string): string {
  const words = action.replace(/[._]/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Something happened";
}

/** The name shown beside an event: the person's email, or "System" when the platform itself acted. */
export function eventActor(event: OrgEvent): string {
  if (event.actorEmail) return event.actorEmail;
  return event.actorUserId ? "Unknown user" : "System";
}
