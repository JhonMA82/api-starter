import { createHmac } from "node:crypto";

import type { DomainEvent } from "../domain/domain-events";
import { WebhookNotActiveError } from "../domain/organization.errors";
import {
  redactSensitiveKeys,
  type WebhookDelivery,
  type WebhookEndpoint,
} from "../domain/webhook.entity";
import type { WebhookRepository } from "./ports";

export interface WebhookDeliverInput {
  url: string;
  secret: string;
  payload: Record<string, unknown>;
  headers: Record<string, string>;
}

export interface WebhookDeliverResult {
  status: number;
}

export interface WebhookDelivererDeps {
  webhooks: WebhookRepository;
  now?: () => Date;
  deliver: (input: WebhookDeliverInput) => Promise<WebhookDeliverResult>;
}

export const WEBHOOK_BACKOFF_BASE_MS = 1_000;
export const WEBHOOK_BACKOFF_MAX_MS = 60 * 60 * 1_000;

/**
 * Exponential backoff for delivery retries: nextAttemptAt = now +
 * min(1s * 2^attempts, 1h). `attempts` is the delivery's attempt count BEFORE
 * this failure is recorded (0 for a first failure -> 1s).
 */
export function computeWebhookNextAttemptAt(attempts: number, now: Date): Date {
  const delay = Math.min(WEBHOOK_BACKOFF_BASE_MS * 2 ** attempts, WEBHOOK_BACKOFF_MAX_MS);
  return new Date(now.getTime() + delay);
}

/**
 * Builds the outgoing webhook headers, including the HMAC signature:
 * `x-webhook-signature: sha256=<HMAC-SHA256(secret, timestamp + "." + JSON.stringify(payload)) hex>`
 * plus the unix timestamp, the event id/type (replay prevention + receiver
 * idempotency via the event id), and a content-type.
 */
export function buildWebhookHeaders(input: {
  secret: string;
  timestamp: number;
  payload: Record<string, unknown>;
  event: DomainEvent;
}): Record<string, string> {
  const body = JSON.stringify(input.payload);
  const signature = createHmac("sha256", input.secret)
    .update(`${input.timestamp}.${body}`)
    .digest("hex");
  return {
    "x-webhook-signature": `sha256=${signature}`,
    "x-webhook-timestamp": String(input.timestamp),
    "x-webhook-event-id": input.event.id,
    "x-webhook-event-type": input.event.type,
    "content-type": "application/json",
    "idempotency-key": input.event.id,
  };
}

export function createWebhookDeliverer(deps: WebhookDelivererDeps) {
  return {
    /**
     * Delivers one event to one endpoint and records the outcome in
     * webhook_deliveries. NEVER throws for HTTP/network failures — those are
     * recorded as a failed delivery with a nextAttemptAt backoff; the retry
     * sweeper (a later WU, driven by the JobQueue) will pick them up.
     */
    async deliverWebhook(endpoint: WebhookEndpoint, event: DomainEvent): Promise<WebhookDelivery> {
      if (!endpoint.active) {
        throw new WebhookNotActiveError(endpoint.id);
      }

      const now = deps.now === undefined ? new Date() : deps.now();
      const payload: Record<string, unknown> = {
        eventId: event.id,
        type: event.type,
        organizationId: event.organizationId,
        occurredAt: event.occurredAt.toISOString(),
        data: redactSensitiveKeys(event.payload),
      };

      const delivery = await deps.webhooks.createDelivery({
        endpointId: endpoint.id,
        eventId: event.id,
        payload,
      });

      const headers = buildWebhookHeaders({
        secret: endpoint.secret,
        timestamp: Math.floor(now.getTime() / 1_000),
        payload,
        event,
      });

      try {
        const result = await deps.deliver({
          url: endpoint.url,
          secret: endpoint.secret,
          payload,
          headers,
        });
        if (result.status >= 200 && result.status < 300) {
          return deps.webhooks.markDeliverySucceeded(delivery.id, result.status);
        }
        return deps.webhooks.markDeliveryFailed(
          delivery.id,
          `webhook endpoint returned HTTP ${result.status}`,
          result.status,
          computeWebhookNextAttemptAt(delivery.attempts, now),
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return deps.webhooks.markDeliveryFailed(
          delivery.id,
          message,
          null,
          computeWebhookNextAttemptAt(delivery.attempts, now),
        );
      }
    },
  };
}

export type WebhookDeliverer = ReturnType<typeof createWebhookDeliverer>;
