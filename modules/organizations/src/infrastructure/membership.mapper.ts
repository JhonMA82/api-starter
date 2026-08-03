import type { Membership, MembershipStatus } from "../domain/membership.entity";
import type { OrganizationRole } from "../domain/organization-roles";
import type { memberships } from "./organization.schema";

export type MembershipRow = typeof memberships.$inferSelect;

export function rowToMembership(row: MembershipRow): Membership {
  return {
    id: row.id,
    organizationId: row.organizationId,
    userId: row.userId,
    role: row.role as OrganizationRole,
    status: row.status as MembershipStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
