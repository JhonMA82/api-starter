import { type ApiKey, assertValidApiKeyName } from "../domain/api-key.entity";
import { createDomainEvent } from "../domain/domain-events";
import { assertMembershipCanAuthorize } from "../domain/membership.entity";
import {
  ForbiddenOrganizationActionError,
  MembershipNotFoundError,
  OrganizationNotFoundError,
  OrganizationSuspendedError,
} from "../domain/organization.errors";
import { generateApiKeySecret } from "./api-key-token";
import type { OrganizationAudit } from "./organization-audit";
import type {
  ApiKeyRepository,
  MembershipRepository,
  OrganizationRepository,
  OutboxRepository,
  UnitOfWork,
} from "./ports";

export interface CreateApiKeyDeps {
  organizations: OrganizationRepository;
  memberships: MembershipRepository;
  apiKeys: ApiKeyRepository;
  audit?: OrganizationAudit;
  uow?: UnitOfWork;
}

export interface CreateApiKeyInput {
  actorUserId: string;
  organizationId: string;
  name: string;
  expiresAt?: Date;
}

export interface CreateApiKeyResult {
  apiKey: ApiKey;
  secret: string;
}

export type CreateApiKeyUseCase = ReturnType<typeof createApiKeyUseCase>;

export function createApiKeyUseCase(deps: CreateApiKeyDeps) {
  return async (input: CreateApiKeyInput): Promise<CreateApiKeyResult> => {
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
      throw new ForbiddenOrganizationActionError("only owner or admin can create api keys");
    }

    assertValidApiKeyName(input.name);

    const { secret, prefix, keyHash } = generateApiKeySecret();
    const name = input.name.trim();
    const create = async (apiKeys: ApiKeyRepository, outbox?: OutboxRepository) => {
      const apiKey = await apiKeys.create({
        organizationId: organization.id,
        name,
        prefix,
        keyHash,
        expiresAt: input.expiresAt ?? null,
      });
      if (outbox !== undefined) {
        await outbox.append(
          createDomainEvent({
            type: "api_key.created",
            organizationId: organization.id,
            actorUserId: input.actorUserId,
            payload: { apiKeyId: apiKey.id, name: apiKey.name, prefix },
          }),
        );
      }
      return apiKey;
    };
    const apiKey =
      deps.uow === undefined
        ? await create(deps.apiKeys)
        : await deps.uow.run((uow) => create(uow.apiKeys, uow.outbox));

    try {
      await deps.audit?.apiKeyCreated(input.actorUserId, organization.id, {
        name: apiKey.name,
        prefix,
      });
    } catch {
      /* audit is best-effort */
    }

    return { apiKey, secret };
  };
}
