import { assertMembershipCanAuthorize } from "../domain/membership.entity";
import {
  ForbiddenOrganizationActionError,
  MembershipNotFoundError,
  OrganizationNotFoundError,
  OrganizationSuspendedError,
  WebhookEndpointNotFoundError,
} from "../domain/organization.errors";
import type { WebhookEndpoint } from "../domain/webhook.entity";
import type { OrganizationAudit } from "./organization-audit";
import type { MembershipRepository, OrganizationRepository, WebhookRepository } from "./ports";
import { createWebhookSecret } from "./webhook-token";

export interface RotateWebhookSecretDeps {
  organizations: OrganizationRepository;
  memberships: MembershipRepository;
  webhooks: WebhookRepository;
  audit?: OrganizationAudit;
}

export interface RotateWebhookSecretInput {
  actorUserId: string;
  organizationId: string;
  webhookId: string;
}

export interface RotateWebhookSecretResult {
  endpoint: WebhookEndpoint;
  /** The new signing secret, returned exactly once. */
  secret: string;
}

export type RotateWebhookSecretUseCase = ReturnType<typeof rotateWebhookSecretUseCase>;

export function rotateWebhookSecretUseCase(deps: RotateWebhookSecretDeps) {
  return async (input: RotateWebhookSecretInput): Promise<RotateWebhookSecretResult> => {
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
      throw new ForbiddenOrganizationActionError("only owner or admin can rotate webhook secrets");
    }

    const endpoint = await deps.webhooks.findEndpointById({
      organizationId: organization.id,
      id: input.webhookId,
    });
    if (endpoint === null) {
      throw new WebhookEndpointNotFoundError(organization.id, input.webhookId);
    }

    const secret = createWebhookSecret();
    const rotated = await deps.webhooks.rotateSecret({
      organizationId: organization.id,
      id: endpoint.id,
      secret,
    });

    try {
      await deps.audit?.webhookSecretRotated(input.actorUserId, organization.id, {
        url: rotated.url,
      });
    } catch {
      /* audit is best-effort */
    }

    return { endpoint: rotated, secret };
  };
}
