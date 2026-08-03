import { createDomainEvent } from "../domain/domain-events";
import {
  assertValidOrganizationName,
  assertValidSlug,
  type Organization,
} from "../domain/organization.entity";
import { OrganizationSlugError } from "../domain/organization.errors";
import type {
  MembershipRepository,
  OrganizationRepository,
  OutboxRepository,
  UnitOfWork,
} from "./ports";

export interface CreateOrganizationDeps {
  organizations: OrganizationRepository;
  memberships: MembershipRepository;
  uow?: UnitOfWork;
}

export interface CreateOrganizationInput {
  name: string;
  slug: string;
  ownerUserId: string;
}

export type CreateOrganizationUseCase = ReturnType<typeof createOrganizationUseCase>;

export function createOrganizationUseCase(deps: CreateOrganizationDeps) {
  return async (input: CreateOrganizationInput): Promise<Organization> => {
    assertValidOrganizationName(input.name);
    assertValidSlug(input.slug);

    const existing = await deps.organizations.findBySlug(input.slug);
    if (existing !== null) {
      throw new OrganizationSlugError(`slug already in use: ${input.slug}`);
    }

    if (deps.uow !== undefined) {
      return deps.uow.run((uow) => createOrganizationWithMembership(uow, input));
    }
    return createOrganizationWithMembership(deps, input);
  };
}

async function createOrganizationWithMembership(
  repos: {
    organizations: OrganizationRepository;
    memberships: MembershipRepository;
    outbox?: OutboxRepository;
  },
  input: CreateOrganizationInput,
): Promise<Organization> {
  const organization = await repos.organizations.create({ name: input.name, slug: input.slug });
  await repos.memberships.create({
    organizationId: organization.id,
    userId: input.ownerUserId,
    role: "owner",
  });
  if (repos.outbox !== undefined) {
    await repos.outbox.append(
      createDomainEvent({
        type: "organization.created",
        organizationId: organization.id,
        actorUserId: input.ownerUserId,
        payload: {
          organizationId: organization.id,
          slug: organization.slug,
          name: organization.name,
        },
      }),
    );
  }
  return organization;
}
