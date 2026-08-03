import type { WebhookProviderSecrets } from "../application/receive-incoming-webhook";

/**
 * Map-backed provider secrets for incoming webhooks (spec §14.6). Reads from
 * a static provider -> secret map wired at app startup; a DB-backed secrets
 * store is a later enhancement (see the ADR). Tests pass their own maps.
 */
export function createStaticWebhookSecrets(map: Record<string, string>): WebhookProviderSecrets {
  const secrets = new Map(Object.entries(map));
  return {
    async getSecret(provider: string): Promise<string | null> {
      return secrets.get(provider) ?? null;
    },
  };
}
