import type { OrgMember, OrgRole } from "@ministry/schema";
import { can } from "./roles.ts";

/** What to call a member who has no email on record (the staff user, or an account Clerk no longer knows). */
export function memberLabel(member: Pick<OrgMember, "email">): string {
  return member.email ?? "Unknown user";
}

/** Whether `caller` may change or remove a member who currently holds `memberRole`. An owner's row is only editable by owners. */
export function canChangeMember(caller: OrgRole, memberRole: OrgRole): boolean {
  return can(caller, "manageMembers") && (memberRole !== "owner" || caller === "owner");
}

/** Whether `caller` may hand out `role`: only an owner may make someone an owner. */
export function canGrantRole(caller: OrgRole, role: OrgRole): boolean {
  return can(caller, "manageMembers") && (role !== "owner" || caller === "owner");
}

/** Owners first, then admins, editors and viewers; by join date, then name, within a role. */
export function sortMembers<T extends Pick<OrgMember, "role" | "joinedAt" | "email">>(members: readonly T[]): T[] {
  const order: OrgRole[] = ["owner", "admin", "editor", "viewer"];
  return [...members].sort(
    (a, b) =>
      order.indexOf(a.role) - order.indexOf(b.role) ||
      a.joinedAt.localeCompare(b.joinedAt) ||
      (a.email ?? "").localeCompare(b.email ?? ""),
  );
}

/** Members who could receive ownership: everyone but the caller. */
export function transferCandidates<T extends Pick<OrgMember, "userId">>(members: readonly T[], callerUserId: string | null | undefined): T[] {
  return members.filter((m) => m.userId !== callerUserId);
}
