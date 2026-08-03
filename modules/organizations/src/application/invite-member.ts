import { assertValidInvitationEmail, type Invitation } from "../domain/invitation.entity";
import { assertMembershipCanAuthorize } from "../domain/membership.entity";
import {
  ForbiddenOrganizationActionError,
  InvalidOrganizationRoleError,
  MembershipNotFoundError,
  OrganizationNotFoundError,
  OrganizationSuspendedError,
} from "../domain/organization.errors";
import { assertValidOrganizationRole, type OrganizationRole } from "../domain/organization-roles";
import type { InvitationRepository, MembershipRepository, OrganizationRepository } from "./ports";
import { createInvitationToken } from "./token";

const INVITATION_TTL_DAYS = 7;
const INVITATION_TTL_MS = INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000;

export interface InviteMemberDeps {
  organizations: OrganizationRepository;
  memberships: MembershipRepository;
  invitations: InvitationRepository;
}

export interface InviteMemberInput {
  actorUserId: string;
  organizationId: string;
  email: string;
  role: OrganizationRole;
}

export interface InviteMemberResult {
  invitation: Invitation;
  token: string;
}

export type InviteMemberUseCase = ReturnType<typeof inviteMemberUseCase>;

export function inviteMemberUseCase(deps: InviteMemberDeps) {
  return async (input: InviteMemberInput): Promise<InviteMemberResult> => {
    const organization = await deps.organizations.findById(input.organizationId);
    if (organization === null) {
      throw new OrganizationNotFoundError(input.organizationId);
    }
    if (organization.status === "suspended") {
      throw new OrganizationSuspendedError(organization.id);
    }

    const actor = await deps.memberships.findActiveByOrganizationAndUser(
      organization.id,
      input.actorUserId,
    );
    if (actor === null) {
      throw new MembershipNotFoundError(organization.id, input.actorUserId);
    }
    assertMembershipCanAuthorize(actor);
    if (actor.role !== "owner" && actor.role !== "admin") {
      throw new ForbiddenOrganizationActionError("only owner or admin can invite members");
    }

    assertValidInvitationEmail(input.email);
    assertValidOrganizationRole(input.role);
    if (input.role === "owner") {
      throw new InvalidOrganizationRoleError(
        input.role,
        "owner cannot be invited as a member; ownership is transferred, not invited",
      );
    }

    const { token, tokenHash } = createInvitationToken();
    const invitation = await deps.invitations.create({
      organizationId: organization.id,
      email: input.email.trim(),
      role: input.role,
      tokenHash,
      expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
    });
    return { invitation, token };
  };
}
