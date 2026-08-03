import type { Invitation } from "../domain/invitation.entity";
import type { OrganizationRole } from "../domain/organization-roles";
import type { invitations } from "./organization.schema";

export type InvitationRow = typeof invitations.$inferSelect;

export function rowToInvitation(row: InvitationRow): Invitation {
  return {
    id: row.id,
    organizationId: row.organizationId,
    email: row.email,
    role: row.role as OrganizationRole,
    tokenHash: row.tokenHash,
    expiresAt: row.expiresAt,
    usedAt: row.usedAt,
    createdAt: row.createdAt,
  };
}
