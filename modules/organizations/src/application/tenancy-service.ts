import { assertMembershipCanAuthorize } from "../domain/membership.entity";
import {
  MembershipNotFoundError,
  OrganizationNotFoundError,
  OrganizationSuspendedError,
} from "../domain/organization.errors";
import { createTenantContext, type TenantContext } from "../domain/tenant-context";
import type { MembershipRepository, OrganizationRepository } from "./ports";

export interface TenancyDeps {
  organizations: OrganizationRepository;
  memberships: MembershipRepository;
}

export interface ResolveTenantInput {
  organizationId: string;
  userId: string;
}

export interface TenancyService {
  resolveTenantContext(input: ResolveTenantInput): Promise<TenantContext>;
}

export function createTenancyService(deps: TenancyDeps): TenancyService {
  return {
    async resolveTenantContext(input: ResolveTenantInput): Promise<TenantContext> {
      const organization = await deps.organizations.findById(input.organizationId);
      if (organization === null) {
        throw new OrganizationNotFoundError(input.organizationId);
      }
      if (organization.status === "suspended") {
        throw new OrganizationSuspendedError(organization.id);
      }

      const membership = await deps.memberships.findActiveByOrganizationAndUser(
        organization.id,
        input.userId,
      );
      if (membership === null) {
        throw new MembershipNotFoundError(organization.id, input.userId);
      }
      assertMembershipCanAuthorize(membership);

      return createTenantContext({
        organizationId: organization.id,
        membershipId: membership.id,
        userId: membership.userId,
        roleIds: [membership.role],
      });
    },
  };
}
