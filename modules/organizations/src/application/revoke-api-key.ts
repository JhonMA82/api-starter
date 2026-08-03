import type { ApiKey } from "../domain/api-key.entity";
import { createDomainEvent } from "../domain/domain-events";
import { assertMembershipCanAuthorize } from "../domain/membership.entity";
import {
  ForbiddenOrganizationActionError,
  MembershipNotFoundError,
  OrganizationNotFoundError,
  OrganizationSuspendedError,
} from "../domain/organization.errors";
import type { OrganizationAudit } from "./organization-audit";
import type {
  ApiKeyRepository,
  MembershipRepository,
  OrganizationRepository,
  OutboxRepository,
  UnitOfWork,
} from "./ports";

export interface RevokeApiKeyDeps {
  organizations: OrganizationRepository;
  memberships: MembershipRepository;
  apiKeys: ApiKeyRepository;
  audit?: OrganizationAudit;
  uow?: UnitOfWork;
}

export interface RevokeApiKeyInput {
  actorUserId: string;
  organizationId: string;
  keyId: string;
}

export type RevokeApiKeyUseCase = ReturnType<typeof revokeApiKeyUseCase>;

export function revokeApiKeyUseCase(deps: RevokeApiKeyDeps) {
  return async (input: RevokeApiKeyInput): Promise<ApiKey> => {
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
      throw new ForbiddenOrganizationActionError("only owner or admin can revoke api keys");
    }

    const revokedAt = new Date();
    const revoke = async (apiKeys: ApiKeyRepository, outbox?: OutboxRepository) => {
      const apiKey = await apiKeys.revoke({
        organizationId: organization.id,
        id: input.keyId,
        revokedAt,
      });
      if (outbox !== undefined) {
        await outbox.append(
          createDomainEvent({
            type: "api_key.revoked",
            organizationId: organization.id,
            actorUserId: input.actorUserId,
            payload: { apiKeyId: apiKey.id, name: apiKey.name, prefix: apiKey.prefix },
          }),
        );
      }
      return apiKey;
    };
    const apiKey =
      deps.uow === undefined
        ? await revoke(deps.apiKeys)
        : await deps.uow.run((uow) => revoke(uow.apiKeys, uow.outbox));

    try {
      await deps.audit?.apiKeyRevoked(input.actorUserId, organization.id, {
        name: apiKey.name,
        prefix: apiKey.prefix,
      });
    } catch {
      /* audit is best-effort */
    }

    return apiKey;
  };
}
