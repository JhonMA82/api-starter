import { and, eq } from "drizzle-orm";

import type { IncomingWebhookRepository } from "../application/ports";
import type { IncomingWebhook, IncomingWebhookStatus } from "../domain/incoming-webhook.entity";
import type { DbOrTransaction } from "./db";
import { incomingWebhooks } from "./incoming-webhook.schema";

export function createIncomingWebhookRepository(db: DbOrTransaction): IncomingWebhookRepository {
  return {
    /**
     * INSERT ... ON CONFLICT (provider, event_id) DO NOTHING; the conflict
     * target IS the idempotency key. `created` tells the caller whether the
     * row was inserted now or already existed (a duplicate delivery).
     */
    async createIfAbsent(input) {
      const [row] = await db
        .insert(incomingWebhooks)
        .values({
          provider: input.provider,
          eventId: input.eventId,
          payload: input.payload,
          signatureValid: input.signatureValid,
        })
        .onConflictDoNothing({
          target: [incomingWebhooks.provider, incomingWebhooks.eventId],
        })
        .returning();
      if (row !== undefined) {
        return { created: true, webhook: rowToIncomingWebhook(row) };
      }
      const existing = await findByProviderAndEventId(input.provider, input.eventId);
      if (existing === null) {
        // The conflict target guaranteed a row exists; a missing row would be
        // an anomaly (e.g. a concurrent delete), not a caller error.
        throw new Error(
          `incoming webhook conflict but no row found: ${input.provider}/${input.eventId}`,
        );
      }
      return { created: false, webhook: existing };
    },
    async findByProviderAndEventId(provider, eventId) {
      return findByProviderAndEventId(provider, eventId);
    },
    async findById(id) {
      const [row] = await db.select().from(incomingWebhooks).where(eq(incomingWebhooks.id, id));
      return row === undefined ? null : rowToIncomingWebhook(row);
    },
    async markProcessing(id) {
      await db
        .update(incomingWebhooks)
        .set({ status: "processing" })
        .where(eq(incomingWebhooks.id, id));
    },
    async markProcessed(id) {
      await db
        .update(incomingWebhooks)
        .set({ status: "processed", processedAt: new Date() })
        .where(eq(incomingWebhooks.id, id));
    },
    async markFailed(id) {
      await db
        .update(incomingWebhooks)
        .set({ status: "failed", processedAt: new Date() })
        .where(eq(incomingWebhooks.id, id));
    },
  };

  async function findByProviderAndEventId(
    provider: string,
    eventId: string,
  ): Promise<IncomingWebhook | null> {
    const [row] = await db
      .select()
      .from(incomingWebhooks)
      .where(and(eq(incomingWebhooks.provider, provider), eq(incomingWebhooks.eventId, eventId)));
    return row === undefined ? null : rowToIncomingWebhook(row);
  }
}

function rowToIncomingWebhook(row: typeof incomingWebhooks.$inferSelect): IncomingWebhook {
  return {
    id: row.id,
    provider: row.provider,
    eventId: row.eventId,
    payload: row.payload,
    signatureValid: row.signatureValid,
    status: row.status as IncomingWebhookStatus,
    receivedAt: row.receivedAt,
    processedAt: row.processedAt,
    createdAt: row.createdAt,
  };
}
