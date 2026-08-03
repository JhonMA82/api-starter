import type { IncomingWebhook } from "../domain/incoming-webhook.entity";
import type { IncomingWebhookRepository } from "./ports";

export interface IncomingWebhookProcessorDeps {
  incomingWebhooks: IncomingWebhookRepository;
  /**
   * Injectable business hook invoked with the received webhook. Defaults to a
   * no-op; swap it per provider (e.g. stripe events -> accounting, github
   * events -> builds). Handler errors mark the webhook failed.
   */
  onEvent?: (webhook: IncomingWebhook) => Promise<void>;
}

/**
 * The JobQueue consumer for `incoming-webhook.process` jobs. Runs a webhook's
 * business handler asynchronously, off the HTTP request path (spec §14.6
 * "respond fast, process asynchronously"). Lifecycle:
 * markProcessing -> onEvent(webhook) -> markProcessed, or markFailed when the
 * handler throws. A webhook that no longer exists is a no-op.
 */
export function createIncomingWebhookProcessor(deps: IncomingWebhookProcessorDeps) {
  return {
    async process(webhookId: string): Promise<void> {
      const webhook = await deps.incomingWebhooks.findById(webhookId);
      if (webhook === null) {
        return;
      }
      await deps.incomingWebhooks.markProcessing(webhookId);
      if (deps.onEvent !== undefined) {
        try {
          await deps.onEvent(webhook);
        } catch {
          await deps.incomingWebhooks.markFailed(webhookId);
          return;
        }
      }
      await deps.incomingWebhooks.markProcessed(webhookId);
    },
  };
}

export type IncomingWebhookProcessor = ReturnType<typeof createIncomingWebhookProcessor>;
