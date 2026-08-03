import { assertMembershipCanAuthorize } from "../domain/membership.entity";
import {
  ForbiddenOrganizationActionError,
  MembershipNotFoundError,
  OrganizationDeletionRequiresConfirmationError,
  OrganizationNotFoundError,
} from "../domain/organization.errors";
import type { MembershipRepository, OrganizationRepository } from "./ports";

export interface DeleteOrganizationDeps {
  organizations: OrganizationRepository;
  memberships: MembershipRepository;
}

export interface DeleteOrganizationInput {
  actorUserId: string;
  organizationId: string;
  confirm: boolean;
}

export type DeleteOrganizationUseCase = ReturnType<typeof deleteOrganizationUseCase>;

export function deleteOrganizationUseCase(deps: DeleteOrganizationDeps) {
  return async (input: DeleteOrganizationInput): Promise<void> => {
    if (!input.confirm) {
      throw new OrganizationDeletionRequiresConfirmationError();
    }

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
      throw new ForbiddenOrganizationActionError("only the owner can delete the organization");
    }

    await deps.organizations.delete(organization.id);
  };
}
