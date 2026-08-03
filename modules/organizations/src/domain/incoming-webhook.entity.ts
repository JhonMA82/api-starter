import { IncomingWebhookEventIdError, InvalidWebhookProviderError } from "./organization.errors";

/**
 * A received incoming webhook (spec §14.6). The receiver side of the webhook
 * integration: providers (stripe, github, n8n, ...) POST signed payloads to
 * /api/v1/webhooks/incoming/:provider; the receiver verifies the signature,
 * stores the parsed payload, and processes it asynchronously.
 *
 * Storage note: the provider's RAW body text is not persisted. Only the
 * PARSED JSON payload is stored; when the body is not parseable as a JSON
 * object, the truncated raw text is kept under `{ raw: "<truncated 4KB>" }`
 * so unparseable deliveries are not silently lost ("conservar cuerpo raw
 * cuando el proveedor lo requiera" — the parsed representation of the body
 * is always retained).
 */
export interface IncomingWebhook {
  id: string;
  /** e.g. "stripe", "github", "n8n" — matches a configured provider secret. */
  provider: string;
  /** Provider event id (x-webhook-event-id header or body id), or a synthetic id. */
  eventId: string;
  /** The redacted, parsed payload that was stored. */
  payload: Record<string, unknown>;
  /** Always true for stored rows: invalid signatures are rejected before storage. */
  signatureValid: boolean;
  status: "received" | "processing" | "processed" | "failed";
  receivedAt: Date;
  processedAt: Date | null;
  createdAt: Date;
}

export type IncomingWebhookStatus = IncomingWebhook["status"];

/**
 * Validates a provider name: non-blank, /^[a-z0-9-]{1,64}$/.
 * Throws InvalidWebhookProviderError otherwise.
 */
export function assertValidProvider(provider: string): void {
  if (!/^[a-z0-9-]{1,64}$/.test(provider)) {
    throw new InvalidWebhookProviderError(provider);
  }
}

const EVENT_ID_MAX_LENGTH = 256;

/**
 * Validates an incoming webhook event id: non-blank, at most 256 characters.
 * Throws IncomingWebhookEventIdError otherwise.
 */
export function assertValidEventId(eventId: string): void {
  if (eventId.trim().length === 0 || eventId.length > EVENT_ID_MAX_LENGTH) {
    throw new IncomingWebhookEventIdError("webhook event id must be 1-256 characters");
  }
}

/** Length cap for the raw body kept when JSON parsing fails (4 KiB). */
export const RAW_PAYLOAD_RETENTION_LIMIT = 4 * 1024;

/**
 * Parses the raw request body for storage. A valid JSON object is returned
 * as-is; anything else (JSON parse failure, or a JSON array/scalar, which is
 * not a valid webhook object) is retained as `{ raw: "<truncated 4KB>" }`.
 * Returns a fresh object so callers can redact it without mutating input.
 */
export function parseIncomingWebhookPayload(rawBody: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(rawBody);
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { ...(parsed as Record<string, unknown>) };
    }
  } catch {
    /* fall through to raw retention */
  }
  return { raw: rawBody.slice(0, RAW_PAYLOAD_RETENTION_LIMIT) };
}
