import type { DomainEventType } from "./domain-events";
import { WebhookEventTypeError, WebhookUrlError } from "./organization.errors";

/**
 * A registered outgoing webhook endpoint for an organization.
 *
 * The signing secret is stored PLAINTEXT in webhook_endpoints.secret. Unlike
 * API keys (stored hashed because they are only ever verified), the endpoint
 * secret must be recoverable to sign outgoing payloads (HMAC), so hashing
 * would defeat its purpose. It is comparable to a Stripe-style endpoint
 * secret: a server-side integration credential that is never returned in API
 * responses except once at creation/rotation time. The ADR (WU6) records this
 * decision.
 */
export interface WebhookEndpoint {
  id: string;
  organizationId: string;
  url: string;
  secret: string;
  /** Subscribed event types; an empty array subscribes to ALL events. */
  events: readonly DomainEventType[];
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface WebhookDelivery {
  id: string;
  endpointId: string;
  eventId: string;
  /** The redacted payload that was sent (sensitive keys stripped). */
  payload: Record<string, unknown>;
  status: "pending" | "succeeded" | "failed";
  attempts: number;
  lastStatusCode: number | null;
  lastError: string | null;
  nextAttemptAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const WEBHOOK_URL_MAX_LENGTH = 2048;

/**
 * Validates that a webhook target URL is an absolute http(s) URL.
 * Throws WebhookUrlError otherwise.
 */
export function assertValidWebhookUrl(url: string): void {
  if (url.trim() === "" || url.trim().length > WEBHOOK_URL_MAX_LENGTH) {
    throw new WebhookUrlError("webhook url must be between 1 and 2048 characters");
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new WebhookUrlError("webhook url must be an absolute http(s) URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new WebhookUrlError("webhook url must use the http or https protocol");
  }
}

const KNOWN_EVENT_TYPES: readonly DomainEventType[] = [
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
 * Normalizes a raw events list: undefined or an empty array means "all event
 * types" (represented as []). Any unknown event type throws
 * WebhookEventTypeError.
 */
export function normalizeEventTypes(events: readonly string[] | undefined): DomainEventType[] {
  if (events === undefined || events.length === 0) {
    return [];
  }
  const seen = new Set<string>();
  const normalized: DomainEventType[] = [];
  for (const raw of events) {
    const type = raw as DomainEventType;
    if (!KNOWN_EVENT_TYPES.includes(type)) {
      throw new WebhookEventTypeError(raw);
    }
    if (!seen.has(type)) {
      seen.add(type);
      normalized.push(type);
    }
  }
  return normalized;
}

/**
 * True when the endpoint subscribes to the given event type. An empty
 * subscription list means "all events".
 */
export function endpointSubscribesTo(
  endpoint: WebhookEndpoint,
  eventType: DomainEventType,
): boolean {
  return endpoint.events.length === 0 || endpoint.events.includes(eventType);
}

const SENSITIVE_KEY_PATTERN = /password|secret|token|authorization|api[_-]?key/i;

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key);
}

/**
 * Recursively strips keys that look sensitive (password, secret, token,
 * authorization, api key) from a payload so stored/forwarded webhook payloads
 * never leak credentials. Arrays keep their length with sensitive entries
 * replaced by "[redacted]" so indexes stay stable. Innocuous keys are kept.
 */
export function redactSensitiveKeys(payload: unknown): Record<string, unknown> {
  const redact = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      return value.map((entry) => redact(entry));
    }
    if (value !== null && typeof value === "object") {
      const result: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        if (isSensitiveKey(key)) {
          result[key] = "[redacted]";
        } else {
          result[key] = redact(entry);
        }
      }
      return result;
    }
    return value;
  };
  return redact(payload) as Record<string, unknown>;
}
