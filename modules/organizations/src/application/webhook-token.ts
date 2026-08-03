import { randomBytes } from "node:crypto";

/**
 * Generates a new webhook signing secret (32 random bytes, base64url). The
 * secret is stored plaintext on the endpoint (it must be recoverable to sign
 * outgoing payloads) and returned exactly once to the caller at
 * creation/rotation time.
 */
export function createWebhookSecret(): string {
  return randomBytes(32).toString("base64url");
}
