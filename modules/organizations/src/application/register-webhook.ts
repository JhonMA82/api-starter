import { assertMembershipCanAuthorize } from "../domain/membership.entity";
import {
  ForbiddenOrganizationActionError,
  MembershipNotFoundError,
  OrganizationNotFoundError,
  OrganizationSuspendedError,
} from "../domain/organization.errors";
import {
  assertValidWebhookUrl,
  normalizeEventTypes,
  type WebhookEndpoint,
} from "../domain/webhook.entity";
import type { OrganizationAudit } from "./organization-audit";
import type { MembershipRepository, OrganizationRepository, WebhookRepository } from "./ports";
import { createWebhookSecret } from "./webhook-token";

export interface RegisterWebhookDeps {
  organizations: OrganizationRepository;
  memberships: MembershipRepository;
  webhooks: WebhookRepository;
  audit?: OrganizationAudit;
}

export interface RegisterWebhookInput {
  actorUserId: string;
  organizationId: string;
  url: string;
  events?: readonly string[];
}

export interface RegisterWebhookResult {
  endpoint: WebhookEndpoint;
  /** The raw signing secret, returned exactly once; stored plaintext on the endpoint. */
  secret: string;
}

export type RegisterWebhookUseCase = ReturnType<typeof registerWebhookUseCase>;

export function registerWebhookUseCase(deps: RegisterWebhookDeps) {
  return async (input: RegisterWebhookInput): Promise<RegisterWebhookResult> => {
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
      throw new ForbiddenOrganizationActionError("only owner or admin can register webhooks");
    }

    assertValidWebhookUrl(input.url);
    const events = normalizeEventTypes(input.events);
    const secret = createWebhookSecret();

    const endpoint = await deps.webhooks.createEndpoint({
      organizationId: organization.id,
      url: input.url.trim(),
      secret,
      events,
    });

    try {
      await deps.audit?.webhookRegistered(input.actorUserId, organization.id, {
        url: endpoint.url,
        events: [...endpoint.events],
      });
    } catch {
      /* audit is best-effort */
    }

    return { endpoint, secret };
  };
}
