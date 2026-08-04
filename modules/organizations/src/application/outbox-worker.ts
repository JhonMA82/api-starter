import type { MetricsRegistry } from "@consulting/core";
import type { DomainEvent, DomainEventType } from "../domain/domain-events";
import type { OutboxRecord } from "../domain/outbox.entity";
import { OutboxEventNotFoundError } from "../domain/outbox.errors";
import type { OutboxRepository } from "./ports";

export type OutboxHandler = (event: DomainEvent) => Promise<void>;

export interface OutboxWorkerDeps {
  outbox: OutboxRepository;
  handlers: Partial<Record<DomainEventType, OutboxHandler>>;
  /**
   * Optional metrics counters (spec §22.2). Absent -> behavior unchanged.
   * Counters: outbox_processed_total, outbox_succeeded_total,
   * outbox_failed_total. A dead-letter counter is intentionally NOT emitted:
   * markFailed is a void port call, so the dead-letter transition (attempts
   * >= max, decided inside the repository) is not observable from the worker.
   */
  metrics?: Pick<MetricsRegistry, "incrementCounter">;
}

export interface OutboxPollResult {
  processed: number;
  succeeded: number;
  failed: number;
}

const BACKOFF_BASE_MS = 1_000;
const BACKOFF_MAX_MS = 60 * 60 * 1_000;

function computeNextAttemptAt(attempts: number, now: Date): Date {
  const delay = Math.min(BACKOFF_BASE_MS * 2 ** attempts, BACKOFF_MAX_MS);
  return new Date(now.getTime() + delay);
}

function toDomainEvent(record: OutboxRecord): DomainEvent {
  return {
    id: record.eventId,
    type: record.type as DomainEventType,
    organizationId: record.organizationId,
    actorUserId: record.actorUserId,
    occurredAt: record.createdAt,
    payload: record.payload,
  };
}

export function createOutboxWorker(deps: OutboxWorkerDeps) {
  return {
    // Process up to `limit` due pending events; for each: markProcessing -> run handler by type ->
    // markSucceeded on success, markFailed(error) on handler error (dead-letter after max attempts).
    // Unknown event type (no handler registered): markFailed('no handler for type X').
    // NEVER throws; per-event errors are captured into the outbox row.
    async poll(limit = 10): Promise<OutboxPollResult> {
      const due = await deps.outbox.findPendingDue(limit);
      let processed = 0;
      let succeeded = 0;
      let failed = 0;
      for (const record of due) {
        processed += 1;
        deps.metrics?.incrementCounter("outbox_processed_total");
        try {
          await deps.outbox.markProcessing(record.id);
          const handler = deps.handlers[record.type as DomainEventType];
          if (handler === undefined) {
            throw new Error(`no handler for type ${record.type}`);
          }
          await handler(toDomainEvent(record));
          await deps.outbox.markSucceeded(record.id);
          deps.metrics?.incrementCounter("outbox_succeeded_total");
          succeeded += 1;
        } catch (error) {
          failed += 1;
          deps.metrics?.incrementCounter("outbox_failed_total");
          const message = error instanceof Error ? error.message : String(error);
          const nextAttemptAt = computeNextAttemptAt(record.attempts, new Date());
          try {
            await deps.outbox.markFailed(record.id, message, nextAttemptAt);
          } catch {
            // Even recording the failure failed; swallow to honor never-throw.
          }
        }
      }
      return { processed, succeeded, failed };
    },
    // Controlled reprocessing of a dead-lettered/failed event (spec 14.3 step 7).
    async reprocess(eventId: string): Promise<OutboxRecord> {
      const record = await deps.outbox.findByEventId(eventId);
      if (record === null) {
        throw new OutboxEventNotFoundError(eventId);
      }
      return deps.outbox.reprocess(record.id);
    },
    async pendingCount(): Promise<number> {
      return deps.outbox.pendingCount();
    },
  };
}
