import { assertMembershipCanAuthorize } from "../domain/membership.entity";
import {
  MembershipNotFoundError,
  OrganizationNotFoundError,
  OrganizationSuspendedError,
} from "../domain/organization.errors";
import type { WebhookEndpoint } from "../domain/webhook.entity";
import type { MembershipRepository, OrganizationRepository, WebhookRepository } from "./ports";

export interface ListWebhooksDeps {
  organizations: OrganizationRepository;
  memberships: MembershipRepository;
  webhooks: WebhookRepository;
}

/** Public shape of an endpoint: everything except the signing secret. */
export type PublicWebhookEndpoint = Omit<WebhookEndpoint, "secret">;

export interface ListWebhooksInput {
  actorUserId: string;
  organizationId: string;
}

export type ListWebhooksUseCase = ReturnType<typeof listWebhooksUseCase>;

export function listWebhooksUseCase(deps: ListWebhooksDeps) {
  return async (input: ListWebhooksInput): Promise<PublicWebhookEndpoint[]> => {
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

    const endpoints = await deps.webhooks.listEndpointsByOrganization(organization.id);
    return endpoints.map((endpoint) => ({
      id: endpoint.id,
      organizationId: endpoint.organizationId,
      url: endpoint.url,
      events: endpoint.events,
      active: endpoint.active,
      createdAt: endpoint.createdAt,
      updatedAt: endpoint.updatedAt,
    }));
  };
}
