import { assertMembershipCanAuthorize, type Membership } from "../domain/membership.entity";
import {
  ForbiddenOrganizationActionError,
  MembershipNotFoundError,
  OrganizationNotFoundError,
  OrganizationSuspendedError,
  OwnerConstraintError,
} from "../domain/organization.errors";
import type { MembershipRepository, OrganizationRepository } from "./ports";

export interface TransferOwnershipDeps {
  organizations: OrganizationRepository;
  memberships: MembershipRepository;
}

export interface TransferOwnershipInput {
  actorUserId: string;
  organizationId: string;
  newOwnerUserId: string;
}

export interface TransferOwnershipResult {
  previousOwner: Membership;
  newOwner: Membership;
}

export type TransferOwnershipUseCase = ReturnType<typeof transferOwnershipUseCase>;

export function transferOwnershipUseCase(deps: TransferOwnershipDeps) {
  return async (input: TransferOwnershipInput): Promise<TransferOwnershipResult> => {
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
    if (actor.role !== "owner") {
      throw new ForbiddenOrganizationActionError("only the owner can transfer ownership");
    }

    const target = await deps.memberships.findByOrganizationAndUser(
      organization.id,
      input.newOwnerUserId,
    );
    if (target === null) {
      throw new MembershipNotFoundError(organization.id, input.newOwnerUserId);
    }
    assertMembershipCanAuthorize(target);
    if (actor.id === target.id) {
      throw new OwnerConstraintError("cannot transfer ownership to yourself");
    }

    const newOwner = await deps.memberships.updateRole({
      organizationId: organization.id,
      id: target.id,
      role: "owner",
    });
    const previousOwner = await deps.memberships.updateRole({
      organizationId: organization.id,
      id: actor.id,
      role: "admin",
    });
    return { previousOwner, newOwner };
  };
}
