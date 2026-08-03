import type { Invitation } from "../domain/invitation.entity";
import type { Membership } from "../domain/membership.entity";
import type { Organization } from "../domain/organization.entity";

export interface OrganizationRepository {
  findById(id: string): Promise<Organization | null>;
}

export interface MembershipRepository {
  findActiveByOrganizationAndUser(
    organizationId: string,
    userId: string,
  ): Promise<Membership | null>;
}

export interface InvitationRepository {
  findByTokenHash(tokenHash: string): Promise<Invitation | null>;
}
