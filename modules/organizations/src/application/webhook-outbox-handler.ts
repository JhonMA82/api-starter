import type { DomainEvent, DomainEventType } from "../domain/domain-events";
import type { WebhookDeliverer } from "./deliver-webhook";
import type { OutboxHandler } from "./outbox-worker";
import type { WebhookRepository } from "./ports";

export interface WebhookOutboxHandlerDeps {
  webhooks: WebhookRepository;
  deliverer: WebhookDeliverer;
}

const ALL_EVENT_TYPES: readonly DomainEventType[] = [
  "organization.created",
  "member.invited",
  "invitation.accepted",
  "ownership.transferred",
  "organization.suspended",
  "organization.deleted",
  "member.removed",
  "api_key.created",
  "api_key.revoked",
];

/**
 * Outbox handlers for webhook fan-out: for each event type, find the active
 * subscribed endpoints of the event's organization and attempt delivery to
 * every one of them. The handler NEVER throws on per-endpoint delivery
 * failure: outcomes live in webhook_deliveries (status failed + nextAttemptAt
 * backoff), so the outbox event resolves as succeeded and the retry sweeper
 * (a later WU, potentially driven by the JobQueue) retries failed deliveries.
 */
export function createWebhookOutboxHandler(
  deps: WebhookOutboxHandlerDeps,
): Partial<Record<DomainEventType, OutboxHandler>> {
  const handlers: Partial<Record<DomainEventType, OutboxHandler>> = {};
  for (const type of ALL_EVENT_TYPES) {
    handlers[type] = async (event: DomainEvent) => {
      const endpoints = await deps.webhooks.findActiveEndpointsByEvent(event.organizationId, type);
      for (const endpoint of endpoints) {
        try {
          await deps.deliverer.deliverWebhook(endpoint, event);
        } catch {
          /* per-endpoint failures stay in webhook_deliveries; keep delivering to the rest */
        }
      }
    };
  }
  return handlers;
}
