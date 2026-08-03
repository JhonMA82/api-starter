import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Sql } from "postgres";

import {
  closeClient,
  createTestClient,
  getDatabaseUrl,
  migrateToLatest,
  resetDatabase,
} from "../../notes/tests/db-test-utils";
import { createOutboxWorker } from "../src/application/outbox-worker";
import { createDomainEvent, type DomainEvent } from "../src/domain/domain-events";
import { createDb, createOutboxRepository } from "../src/infrastructure";

const databaseUrl = getDatabaseUrl();
const describeDb = databaseUrl === null ? describe.skip : describe;
if (databaseUrl === null) {
  console.warn(
    "[organizations outbox worker tests] DATABASE_URL is not set — skipping real-DB tests",
  );
}

function makeEvent(overrides: Partial<DomainEvent> = {}): DomainEvent {
  return createDomainEvent({
    type: "organization.created",
    organizationId: "org-1",
    actorUserId: "user-1",
    payload: { organizationId: "org-1" },
    ...overrides,
  });
}

async function requeue(client: Sql, rowId: string): Promise<void> {
  await client.unsafe(
    `UPDATE outbox_events SET status = 'pending', next_attempt_at = now() WHERE id = '${rowId}'`,
  );
}

describeDb("outbox worker (real database)", () => {
  const client = createTestClient(databaseUrl as string);

  beforeAll(async () => {
    await resetDatabase(client);
    await migrateToLatest(client);
  });

  afterAll(async () => {
    await closeClient(client);
  });

  test("poll runs a successful handler and marks the event succeeded", async () => {
    const outbox = createOutboxRepository(createDb(client));
    const seen: string[] = [];
    const worker = createOutboxWorker({
      outbox,
      handlers: {
        "organization.created": async (event) => {
          seen.push(event.id);
        },
      },
    });
    const event = makeEvent();
    await outbox.append(event);

    const result = await worker.poll(10);

    expect(result).toEqual({ processed: 1, succeeded: 1, failed: 0 });
    expect(seen).toEqual([event.id]);

    const record = await outbox.findByEventId(event.id);
    expect(record).toMatchObject({ status: "succeeded", attempts: 0 });
    expect(record?.processedAt).toBeInstanceOf(Date);
  });

  test("poll records a handler failure as failed with attempts 1 and backoff", async () => {
    const outbox = createOutboxRepository(createDb(client));
    const worker = createOutboxWorker({
      outbox,
      handlers: {
        "organization.created": async () => {
          throw new Error("boom");
        },
      },
    });
    const event = makeEvent();
    await outbox.append(event);

    const result = await worker.poll(10);

    expect(result).toEqual({ processed: 1, succeeded: 0, failed: 1 });
    const record = await outbox.findByEventId(event.id);
    expect(record).toMatchObject({
      status: "failed",
      attempts: 1,
      lastError: "boom",
    });
    expect((record?.nextAttemptAt.getTime() ?? 0) - Date.now()).toBeGreaterThan(500);
  });

  test("repeated failing polls dead-letter the event after max attempts", async () => {
    const outbox = createOutboxRepository(createDb(client));
    const worker = createOutboxWorker({
      outbox,
      handlers: {
        "organization.created": async () => {
          throw new Error("boom");
        },
      },
    });
    const event = makeEvent();
    await outbox.append(event);

    for (let i = 1; i <= 5; i += 1) {
      const result = await worker.poll(10);
      expect(result).toEqual({ processed: 1, succeeded: 0, failed: 1 });
      const record = await outbox.findByEventId(event.id);
      if (i < 5) {
        expect(record?.status).toBe("failed");
        await requeue(client, record?.id as string);
      }
    }

    const deadLetter = await outbox.findByEventId(event.id);
    expect(deadLetter).toMatchObject({ status: "dead_letter", attempts: 5 });
  });

  test("reprocess requeues a dead-lettered event and it succeeds on the next poll", async () => {
    const outbox = createOutboxRepository(createDb(client));
    let fail = true;
    const worker = createOutboxWorker({
      outbox,
      handlers: {
        "organization.created": async () => {
          if (fail) {
            throw new Error("boom");
          }
        },
      },
    });
    const event = makeEvent();
    await outbox.append(event);

    for (let i = 1; i <= 5; i += 1) {
      await worker.poll(10);
      const record = await outbox.findByEventId(event.id);
      if (i < 5) {
        await requeue(client, record?.id as string);
      }
    }
    expect(await outbox.findByEventId(event.id)).toMatchObject({ status: "dead_letter" });

    const reprocessed = await worker.reprocess(event.id);

    expect(reprocessed).toMatchObject({
      eventId: event.id,
      status: "pending",
      attempts: 0,
      lastError: null,
    });

    fail = false;
    const result = await worker.poll(10);

    expect(result).toEqual({ processed: 1, succeeded: 1, failed: 0 });
    expect(await outbox.findByEventId(event.id)).toMatchObject({ status: "succeeded" });
  });

  test("an unknown event type fails with 'no handler for type X'", async () => {
    const outbox = createOutboxRepository(createDb(client));
    const worker = createOutboxWorker({ outbox, handlers: {} });
    const event = makeEvent({ type: "member.invited" });
    await outbox.append(event);

    const result = await worker.poll(10);

    expect(result).toEqual({ processed: 1, succeeded: 0, failed: 1 });
    expect(await outbox.findByEventId(event.id)).toMatchObject({
      status: "failed",
      attempts: 1,
      lastError: "no handler for type member.invited",
    });
  });

  test("pendingCount reflects pending events", async () => {
    const outbox = createOutboxRepository(createDb(client));
    const worker = createOutboxWorker({
      outbox,
      handlers: {
        "organization.created": async () => {},
      },
    });
    await outbox.append(makeEvent());

    expect(await worker.pendingCount()).toBeGreaterThanOrEqual(1);

    await worker.poll(10);

    expect(await worker.pendingCount()).toBe(0);
  });
});
