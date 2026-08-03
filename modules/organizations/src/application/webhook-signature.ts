import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Shared HMAC signing/verification for webhooks (spec §14.5 outgoing, §14.6
 * incoming). The signature scheme is:
 *   x-webhook-signature: sha256=<HMAC-SHA256(secret, timestamp + "." + body) hex>
 * where `body` is the exact raw request/response body text and `timestamp` is
 * the unix-seconds string used on the wire. The receiver MUST verify over the
 * RAW body (before any parsing), so this module deliberately works on strings.
 */
export const WEBHOOK_SIGNATURE_HEADER = "x-webhook-signature";
export const WEBHOOK_TIMESTAMP_HEADER = "x-webhook-timestamp";
export const WEBHOOK_EVENT_ID_HEADER = "x-webhook-event-id";

const SIGNATURE_PREFIX = "sha256=";
const HMAC_HEX_LENGTH = 64;

/**
 * Max acceptable clock skew between the provider's x-webhook-timestamp and
 * our clock, in seconds (replay prevention window, spec §14.5/§14.6).
 */
export const WEBHOOK_MAX_CLOCK_SKEW_SECONDS = 300;

/**
 * `sha256=` + hex of HMAC-SHA256(secret, timestamp + "." + body). The exact
 * inverse of what the outgoing deliverer sends, so incoming receivers verify
 * the same scheme.
 */
export function signWebhookPayload(secret: string, timestamp: string, body: string): string {
  const hmac = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `${SIGNATURE_PREFIX}${hmac}`;
}

/**
 * Timing-safe verification of a `sha256=<hex>` signature over the raw body.
 * Returns false (never throws) for a missing or malformed signature: wrong
 * prefix, non-hex characters, or a length other than 64 hex chars.
 */
export function verifyWebhookSignature(
  secret: string,
  timestamp: string,
  body: string,
  signature: string,
): boolean {
  if (!signature.startsWith(SIGNATURE_PREFIX)) {
    return false;
  }
  const providedHex = signature.slice(SIGNATURE_PREFIX.length);
  if (providedHex.length !== HMAC_HEX_LENGTH || !/^[0-9a-f]+$/.test(providedHex)) {
    return false;
  }
  const expected = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest();
  // Both buffers are exactly 32 bytes (sha256), so timingSafeEqual never throws.
  return timingSafeEqual(expected, Buffer.from(providedHex, "hex"));
}

/**
 * True when `timestamp` (unix seconds as sent by the provider) is within the
 * 5-minute freshness window around `now`. Rejects unparseable timestamps —
 * the timestamp is part of the signed content, so an unparseable value can
 * never be verified and must be treated as stale (replay prevention).
 */
export function isWebhookTimestampFresh(timestamp: string, now: Date): boolean {
  if (!/^\d+$/.test(timestamp)) {
    return false;
  }
  const seconds = Number(timestamp);
  const skew = Math.abs(now.getTime() / 1_000 - seconds);
  return skew <= WEBHOOK_MAX_CLOCK_SKEW_SECONDS;
}
