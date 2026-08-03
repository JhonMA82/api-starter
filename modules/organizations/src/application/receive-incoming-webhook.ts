import type { AuditLogger } from "@consulting/audit";
import type { JobQueue } from "@consulting/module-jobs";

import {
  assertValidEventId,
  assertValidProvider,
  type IncomingWebhook,
  parseIncomingWebhookPayload,
} from "../domain/incoming-webhook.entity";
import {
  InvalidWebhookSignatureError,
  ProviderNotConfiguredError,
} from "../domain/organization.errors";
import { redactSensitiveKeys } from "../domain/webhook.entity";
import type { IncomingWebhookRepository } from "./ports";
import { isWebhookTimestampFresh, verifyWebhookSignature } from "./webhook-signature";

/** Job type enqueued for asynchronous processing of a received webhook. */
export const INCOMING_WEBHOOK_JOB_TYPE = "incoming-webhook.process";

/**
 * Resolves the provider secret for a provider. A DB-backed secrets store is a
 * later enhancement (see the ADR); the app wires the static map for now.
 */
export interface WebhookProviderSecrets {
  getSecret(provider: string): Promise<string | null>;
}

export interface ReceiveIncomingWebhookInput {
  provider: string;
  /** x-webhook-signature header value, or null when absent. */
  signatureHeader: string | null;
  /** x-webhook-timestamp header value (unix seconds), or null when absent. */
  timestampHeader: string | null;
  /** x-webhook-event-id header value, or null when absent. */
  eventIdHeader: string | null;
  /** The exact raw request body text; signatures are verified over it. */
  rawBody: string;
}

export interface ReceiveIncomingWebhookDeps {
  incomingWebhooks: IncomingWebhookRepository;
  secrets: WebhookProviderSecrets;
  /** Asynchronous processing queue; null = mark received webhooks processed immediately. */
  queue: JobQueue | null;
  audit?: AuditLogger;
  now?: () => Date;
}

export type ReceiveIncomingWebhookResult =
  | { status: "accepted"; webhook: IncomingWebhook }
  | { status: "duplicate"; webhook: IncomingWebhook };

export type ReceiveIncomingWebhookUseCase = (
  input: ReceiveIncomingWebhookInput,
) => Promise<ReceiveIncomingWebhookResult>;

const EVENT_ID_BODY_KEYS = ["id", "event_id", "eventId"] as const;

/**
 * Event id resolution order: the x-webhook-event-id header wins; otherwise
 * the body's id/event_id/eventId string field; otherwise a synthetic
 * `synthetic-<random>` id so replay idempotency still works for providers
 * that do not carry event ids.
 */
function resolveEventId(eventIdHeader: string | null, rawBody: string): string {
  if (eventIdHeader !== null && eventIdHeader.trim() !== "") {
    return eventIdHeader;
  }
  try {
    const parsed: unknown = JSON.parse(rawBody);
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>;
      for (const key of EVENT_ID_BODY_KEYS) {
        const value = record[key];
        if (typeof value === "string" && value.trim() !== "") {
          return value;
        }
      }
    }
  } catch {
    /* unparseable body -> synthetic id */
  }
  return `synthetic-${crypto.randomUUID()}`;
}

export function createReceiveIncomingWebhookUseCase(
  deps: ReceiveIncomingWebhookDeps,
): ReceiveIncomingWebhookUseCase {
  return async (input) => {
    // 1. Provider validation + secret resolution. Unknown providers and
    //    providers without a configured secret are indistinguishable: both
    //    surface as ProviderNotConfiguredError (404 at the HTTP layer) so
    //    the outside world cannot probe which providers exist.
    assertValidProvider(input.provider);
    const secret = await deps.secrets.getSecret(input.provider);
    if (secret === null) {
      throw new ProviderNotConfiguredError(input.provider);
    }

    // 2. Event id (header -> body -> synthetic) — the idempotency key.
    const eventId = resolveEventId(input.eventIdHeader, input.rawBody);
    assertValidEventId(eventId);

    // 3. Signature verification over the RAW body BEFORE any business
    //    parsing, plus the 5-minute freshness window (replay prevention).
    const timestamp = input.timestampHeader ?? "";
    const now = deps.now === undefined ? new Date() : deps.now();
    const signatureValid =
      verifyWebhookSignature(secret, timestamp, input.rawBody, input.signatureHeader ?? "") &&
      isWebhookTimestampFresh(timestamp, now);

    // 4. Invalid signatures are rejected outright and never stored.
    if (!signatureValid) {
      throw new InvalidWebhookSignatureError();
    }

    // 5. Idempotent dedupe by (provider, event id); duplicates are never
    //    re-processed.
    const payload = redactSensitiveKeys(parseIncomingWebhookPayload(input.rawBody));
    const { created, webhook } = await deps.incomingWebhooks.createIfAbsent({
      provider: input.provider,
      eventId,
      payload,
      signatureValid: true,
    });
    if (!created) {
      return { status: "duplicate", webhook };
    }

    // 6. Best-effort audit: providers/event ids are recorded for traceability
    //    (spec §14.6 "provider + event id logging").
    if (deps.audit !== undefined) {
      try {
        await deps.audit.record({
          action: "webhook.received",
          resourceType: "webhook",
          resourceId: webhook.id,
          outcome: "success",
          metadata: { provider: input.provider, eventId, signatureValid: true },
        });
      } catch {
        /* audit is best-effort; the webhook is still accepted */
      }
    }

    // 7. Respond fast: enqueue processing and return; without a queue, mark
    //    the webhook processed immediately (nothing to process).
    if (deps.queue !== null) {
      await deps.queue.enqueue({
        type: INCOMING_WEBHOOK_JOB_TYPE,
        payload: { webhookId: webhook.id, provider: input.provider, eventId },
      });
    } else {
      await deps.incomingWebhooks.markProcessed(webhook.id);
    }

    return { status: "accepted", webhook };
  };
}
