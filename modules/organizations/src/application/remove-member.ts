import { assertMembershipCanAuthorize } from "../domain/membership.entity";
import {
  ForbiddenOrganizationActionError,
  MembershipNotFoundError,
  OrganizationNotFoundError,
  OwnerConstraintError,
} from "../domain/organization.errors";
import type { MembershipRepository, OrganizationRepository } from "./ports";

export interface RemoveMemberDeps {
  organizations: OrganizationRepository;
  memberships: MembershipRepository;
}

export interface RemoveMemberInput {
  actorUserId: string;
  organizationId: string;
  targetUserId: string;
}

export type RemoveMemberUseCase = ReturnType<typeof removeMemberUseCase>;

export function removeMemberUseCase(deps: RemoveMemberDeps) {
  return async (input: RemoveMemberInput): Promise<void> => {
    const organization = await deps.organizations.findById(input.organizationId);
    if (organization === null) {
      throw new OrganizationNotFoundError(input.organizationId);
    }

    const actor = await deps.memberships.findActiveByOrganizationAndUser(
      organization.id,
      input.actorUserId,
    );
    if (actor === null) {
      throw new MembershipNotFoundError(organization.id, input.actorUserId);
    }
    assertMembershipCanAuthorize(actor);

    if (actor.userId !== input.targetUserId && actor.role !== "owner" && actor.role !== "admin") {
      throw new ForbiddenOrganizationActionError("only owner or admin can remove members");
    }

    const target = await deps.memberships.findByOrganizationAndUser(
      organization.id,
      input.targetUserId,
    );
    if (target === null) {
      throw new MembershipNotFoundError(organization.id, input.targetUserId);
    }
    assertMembershipCanAuthorize(target);

    if (target.role === "owner" && (await deps.memberships.countOwners(organization.id)) <= 1) {
      throw new OwnerConstraintError(
        "an organization must keep at least one owner; transfer ownership first",
      );
    }

    await deps.memberships.delete({ organizationId: organization.id, id: target.id });
  };
}
