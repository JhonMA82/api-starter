import { assertMembershipCanAuthorize } from "../domain/membership.entity";
import type { Organization } from "../domain/organization.entity";
import {
  ForbiddenOrganizationActionError,
  MembershipNotFoundError,
  OrganizationNotFoundError,
} from "../domain/organization.errors";
import type { MembershipRepository, OrganizationRepository } from "./ports";

export interface SuspendOrganizationDeps {
  organizations: OrganizationRepository;
  memberships: MembershipRepository;
}

export interface SuspendOrganizationInput {
  actorUserId: string;
  organizationId: string;
}

export type SuspendOrganizationUseCase = ReturnType<typeof suspendOrganizationUseCase>;

export function suspendOrganizationUseCase(deps: SuspendOrganizationDeps) {
  return async (input: SuspendOrganizationInput): Promise<Organization> => {
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
    if (actor.role !== "owner") {
      throw new ForbiddenOrganizationActionError("only the owner can suspend the organization");
    }

    return deps.organizations.updateStatus(organization.id, "suspended");
  };
}
