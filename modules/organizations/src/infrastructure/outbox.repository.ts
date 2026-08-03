import { and, asc, eq, lte, sql } from "drizzle-orm";

import type { OutboxRepository } from "../application/ports";
import type { DomainEvent } from "../domain/domain-events";
import type { OutboxRecord, OutboxStatus } from "../domain/outbox.entity";
import { OutboxEventNotFoundError } from "../domain/outbox.errors";
import type { DbOrTransaction } from "./db";
import { outboxEvents } from "./outbox.schema";

export function createOutboxRepository(db: DbOrTransaction): OutboxRepository {
  return {
    async append(event: DomainEvent) {
      await db
        .insert(outboxEvents)
        .values({
          eventId: event.id,
          type: event.type,
          organizationId: event.organizationId,
          actorUserId: event.actorUserId,
          payload: event.payload,
        })
        .onConflictDoNothing({ target: outboxEvents.eventId });
    },
    async findPendingDue(limit: number) {
      const rows = await db
        .select()
        .from(outboxEvents)
        .where(and(eq(outboxEvents.status, "pending"), lte(outboxEvents.nextAttemptAt, new Date())))
        .orderBy(asc(outboxEvents.createdAt))
        .limit(limit);
      return rows.map(rowToOutboxRecord);
    },
    async findByEventId(eventId: string) {
      const [row] = await db.select().from(outboxEvents).where(eq(outboxEvents.eventId, eventId));
      return row === undefined ? null : rowToOutboxRecord(row);
    },
    async markProcessing(id: string) {
      await db
        .update(outboxEvents)
        .set({ status: "processing", updatedAt: new Date() })
        .where(eq(outboxEvents.id, id));
    },
    async markSucceeded(id: string) {
      await db
        .update(outboxEvents)
        .set({ status: "succeeded", processedAt: new Date(), updatedAt: new Date() })
        .where(eq(outboxEvents.id, id));
    },
    async markFailed(id: string, error: string, nextAttemptAt?: Date) {
      await db
        .update(outboxEvents)
        .set({
          attempts: sql`${outboxEvents.attempts} + 1`,
          lastError: error,
          status: sql`case when ${outboxEvents.attempts} + 1 >= ${outboxEvents.maxAttempts} then 'dead_letter' else 'failed' end`,
          nextAttemptAt: nextAttemptAt ?? new Date(),
          updatedAt: new Date(),
        })
        .where(eq(outboxEvents.id, id));
    },
    async listByStatus(status: string, limit: number) {
      const rows = await db
        .select()
        .from(outboxEvents)
        .where(eq(outboxEvents.status, status))
        .orderBy(asc(outboxEvents.createdAt))
        .limit(limit);
      return rows.map(rowToOutboxRecord);
    },
    async reprocess(id: string) {
      const [row] = await db
        .update(outboxEvents)
        .set({
          status: "pending",
          attempts: 0,
          lastError: null,
          processedAt: null,
          nextAttemptAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(outboxEvents.id, id))
        .returning();
      if (row === undefined) {
        throw new OutboxEventNotFoundError(id);
      }
      return rowToOutboxRecord(row);
    },
    async pendingCount() {
      const [row] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(outboxEvents)
        .where(eq(outboxEvents.status, "pending"));
      return row?.count ?? 0;
    },
  };
}

function rowToOutboxRecord(row: typeof outboxEvents.$inferSelect): OutboxRecord {
  return {
    id: row.id,
    eventId: row.eventId,
    type: row.type,
    organizationId: row.organizationId,
    actorUserId: row.actorUserId,
    payload: row.payload,
    status: row.status as OutboxStatus,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    lastError: row.lastError,
    nextAttemptAt: row.nextAttemptAt,
    processedAt: row.processedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
