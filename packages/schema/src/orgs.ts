import { z } from "zod";

/**
 * Organizations, members, invitations and the audit log. Membership is ours (not Clerk's):
 * every role, quota and event hangs off these shapes, and the web app gates its controls on `OrgRole`.
 */

/** Ordered from least to most capable; `roleAtLeast` compares along this order. */
export const ORG_ROLES = ["viewer", "editor", "admin", "owner"] as const;
export const OrgRole = z.enum(ORG_ROLES);
export type OrgRole = z.infer<typeof OrgRole>;

/** Roles an invitation can carry. Ownership is only ever granted by an owner (role change or transfer). */
export const INVITABLE_ROLES = ["viewer", "editor", "admin"] as const;
export const InvitableRole = z.enum(INVITABLE_ROLES);
export type InvitableRole = z.infer<typeof InvitableRole>;

const RANK: Record<OrgRole, number> = { viewer: 0, editor: 1, admin: 2, owner: 3 };

/** True when `role` grants at least what `minimum` grants (owner > admin > editor > viewer). */
export function roleAtLeast(role: OrgRole, minimum: OrgRole): boolean {
  return RANK[role] >= RANK[minimum];
}

/** What each role may do, in words the UI shows next to the role picker. */
export const ROLE_DESCRIPTIONS: Record<OrgRole, string> = {
  viewer: "Can view sites and read messages. Cannot edit or publish.",
  editor: "Can edit content, publish, and manage messages.",
  admin: "Can also manage members, domains and integrations.",
  owner: "Everything, including deleting sites and transferring ownership.",
};

export const OrgSummary = z.object({
  id: z.string(),
  name: z.string(),
  /** The caller's role in this organization. */
  role: OrgRole,
  createdAt: z.string(),
});
export type OrgSummary = z.infer<typeof OrgSummary>;

export const OrgsResponse = z.object({ orgs: z.array(OrgSummary) });
export type OrgsResponse = z.infer<typeof OrgsResponse>;

export const OrgMember = z.object({
  userId: z.string(),
  /** Null for the staff automation user and for accounts whose Clerk record was deleted. */
  email: z.string().nullable(),
  role: OrgRole,
  invitedBy: z.string().nullable(),
  joinedAt: z.string(),
});
export type OrgMember = z.infer<typeof OrgMember>;

export const PendingInvitation = z.object({
  id: z.string(),
  email: z.string(),
  role: InvitableRole,
  invitedBy: z.string().nullable(),
  expiresAt: z.string(),
  createdAt: z.string(),
});
export type PendingInvitation = z.infer<typeof PendingInvitation>;

export const MembersResponse = z.object({
  members: z.array(OrgMember),
  /** Pending (unaccepted, unexpired) invitations. Only admins and owners see them; others get an empty list. */
  invitations: z.array(PendingInvitation),
});
export type MembersResponse = z.infer<typeof MembersResponse>;

export const UpdateMemberRequest = z.object({ role: OrgRole });
export type UpdateMemberRequest = z.infer<typeof UpdateMemberRequest>;

export const CreateInvitationRequest = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  role: InvitableRole,
});
export type CreateInvitationRequest = z.infer<typeof CreateInvitationRequest>;

export const CreateInvitationResponse = z.object({
  invitation: PendingInvitation,
  /** "email" when the invitation was sent; "link" when no sender is configured and the inviter must pass `link` on. */
  delivery: z.enum(["email", "link"]),
  link: z.string().optional(),
});
export type CreateInvitationResponse = z.infer<typeof CreateInvitationResponse>;

/** What anyone holding the link may learn before signing in. The invitee address is masked. */
export const InvitationPreview = z.object({
  orgName: z.string(),
  role: InvitableRole,
  /** Who sent it, as the email they signed in with; null when unknown. */
  inviterEmail: z.string().nullable(),
  /** The invited address, masked like "j***@example.org". */
  email: z.string(),
  expiresAt: z.string(),
});
export type InvitationPreview = z.infer<typeof InvitationPreview>;

export const AcceptInvitationResponse = z.object({ orgId: z.string(), orgName: z.string(), role: OrgRole });
export type AcceptInvitationResponse = z.infer<typeof AcceptInvitationResponse>;

export const TransferOwnershipRequest = z.object({ userId: z.string().min(1) });
export type TransferOwnershipRequest = z.infer<typeof TransferOwnershipRequest>;

/** Audit actions. The target names what was acted on (a user id, site id, hostname…); detail is free-form JSON. */
export const ORG_EVENT_ACTIONS = [
  "member.invited",
  "member.joined",
  "member.role_changed",
  "member.removed",
  "invitation.revoked",
  "ownership.transferred",
  "site.published",
  "site.unpublished",
  "site.deleted",
  "domain.added",
  "domain.removed",
  "integration.connected",
  "integration.updated",
  "integration.disconnected",
] as const;
export const OrgEventAction = z.enum(ORG_EVENT_ACTIONS);
export type OrgEventAction = z.infer<typeof OrgEventAction>;

export const OrgEvent = z.object({
  id: z.string(),
  action: OrgEventAction,
  /** Null when the system acted (for example a Clerk account deletion). */
  actorUserId: z.string().nullable(),
  actorEmail: z.string().nullable(),
  target: z.string().nullable(),
  detail: z.record(z.unknown()).nullable(),
  createdAt: z.string(),
});
export type OrgEvent = z.infer<typeof OrgEvent>;

export const EventsResponse = z.object({ events: z.array(OrgEvent) });
export type EventsResponse = z.infer<typeof EventsResponse>;
