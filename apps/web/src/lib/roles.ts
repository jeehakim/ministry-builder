import { roleAtLeast, type OrgRole } from "@ministry/schema";

export type Action =
  | "edit"
  | "publish"
  | "ai"
  | "manageMembers"
  | "manageDomains"
  | "manageIntegrations"
  | "deleteSite"
  | "transferOwnership"
  | "createSite";

/** The lowest role that may do each thing. The server enforces the same rules; this only decides what the UI offers. */
const MINIMUM_ROLE: Record<Action, OrgRole> = {
  edit: "editor",
  publish: "editor",
  ai: "editor",
  manageMembers: "admin",
  manageDomains: "admin",
  manageIntegrations: "admin",
  createSite: "admin",
  deleteSite: "owner",
  transferOwnership: "owner",
};

/** Whether someone with `role` in an organization may do `action`. */
export function can(role: OrgRole, action: Action): boolean {
  return roleAtLeast(role, MINIMUM_ROLE[action]);
}
