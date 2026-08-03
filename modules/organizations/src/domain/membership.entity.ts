import { InactiveMembershipError } from "./organization.errors";
import type { OrganizationRole } from "./organization-roles";

export type MembershipStatus = "active" | "inactive";

export interface Membership {
  id: string;
  organizationId: string;
  userId: string;
  role: OrganizationRole;
  status: MembershipStatus;
  createdAt: Date;
  updatedAt: Date;
}

export function assertMembershipCanAuthorize(membership: Membership): void {
  if (membership.status !== "active") {
    throw new InactiveMembershipError(membership.id);
  }
}
