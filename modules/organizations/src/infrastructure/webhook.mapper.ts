import type { DomainEventType } from "../domain/domain-events";
import type { WebhookDelivery, WebhookEndpoint } from "../domain/webhook.entity";
import type { webhookDeliveries, webhookEndpoints } from "./webhook.schema";

export type WebhookEndpointRow = typeof webhookEndpoints.$inferSelect;
export type WebhookDeliveryRow = typeof webhookDeliveries.$inferSelect;

export function rowToWebhookEndpoint(row: WebhookEndpointRow): WebhookEndpoint {
  return {
    id: row.id,
    organizationId: row.organizationId,
    url: row.url,
    secret: row.secret,
    events: row.events as DomainEventType[],
    active: row.active,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function rowToWebhookDelivery(row: WebhookDeliveryRow): WebhookDelivery {
  return {
    id: row.id,
    endpointId: row.endpointId,
    eventId: row.eventId,
    payload: row.payload,
    status: row.status as WebhookDelivery["status"],
    attempts: row.attempts,
    lastStatusCode: row.lastStatusCode,
    lastError: row.lastError,
    nextAttemptAt: row.nextAttemptAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
