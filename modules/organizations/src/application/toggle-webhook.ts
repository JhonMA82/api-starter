import { assertMembershipCanAuthorize } from "../domain/membership.entity";
import {
  ForbiddenOrganizationActionError,
  MembershipNotFoundError,
  OrganizationNotFoundError,
  OrganizationSuspendedError,
  WebhookEndpointNotFoundError,
} from "../domain/organization.errors";
import type { WebhookEndpoint } from "../domain/webhook.entity";
import type { MembershipRepository, OrganizationRepository, WebhookRepository } from "./ports";

export interface ToggleWebhookDeps {
  organizations: OrganizationRepository;
  memberships: MembershipRepository;
  webhooks: WebhookRepository;
}

export interface ToggleWebhookInput {
  actorUserId: string;
  organizationId: string;
  webhookId: string;
  active: boolean;
}

export type ToggleWebhookUseCase = ReturnType<typeof toggleWebhookUseCase>;

export function toggleWebhookUseCase(deps: ToggleWebhookDeps) {
  return async (input: ToggleWebhookInput): Promise<WebhookEndpoint> => {
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
      throw new ForbiddenOrganizationActionError("only owner or admin can toggle webhooks");
    }

    const endpoint = await deps.webhooks.findEndpointById({
      organizationId: organization.id,
      id: input.webhookId,
    });
    if (endpoint === null) {
      throw new WebhookEndpointNotFoundError(organization.id, input.webhookId);
    }

    return deps.webhooks.setActive({
      organizationId: organization.id,
      id: endpoint.id,
      active: input.active,
    });
  };
}
