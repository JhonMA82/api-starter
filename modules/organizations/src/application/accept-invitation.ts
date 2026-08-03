import { assertInvitationUsable } from "../domain/invitation.entity";
import type { Membership } from "../domain/membership.entity";
import {
  InvitationNotFoundError,
  OrganizationNotFoundError,
  OrganizationSuspendedError,
} from "../domain/organization.errors";
import type { InvitationRepository, MembershipRepository, OrganizationRepository } from "./ports";
import { hashInvitationToken } from "./token";

export interface AcceptInvitationDeps {
  organizations: OrganizationRepository;
  memberships: MembershipRepository;
  invitations: InvitationRepository;
}

export interface AcceptInvitationInput {
  token: string;
  userId: string;
}

export type AcceptInvitationUseCase = ReturnType<typeof acceptInvitationUseCase>;

export function acceptInvitationUseCase(deps: AcceptInvitationDeps) {
  return async (input: AcceptInvitationInput): Promise<Membership> => {
    const tokenHash = hashInvitationToken(input.token);
    const invitation = await deps.invitations.findByTokenHash(tokenHash);
    if (invitation === null) {
      throw new InvitationNotFoundError(tokenHash);
    }
    assertInvitationUsable(invitation, new Date());

    const organization = await deps.organizations.findById(invitation.organizationId);
    if (organization === null) {
      throw new OrganizationNotFoundError(invitation.organizationId);
    }
    if (organization.status === "suspended") {
      throw new OrganizationSuspendedError(organization.id);
    }

    const now = new Date();
    const membership = await deps.memberships.create({
      organizationId: invitation.organizationId,
      userId: input.userId,
      role: invitation.role,
    });
    await deps.invitations.markUsed(invitation.id, now);
    return membership;
  };
}
