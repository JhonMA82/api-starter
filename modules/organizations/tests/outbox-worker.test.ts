import { describe, expect, test } from "bun:test";

import { createOutboxWorker } from "../src/application/outbox-worker";
import { createDomainEvent, type DomainEvent } from "../src/domain/domain-events";
import { createFakeOutboxRepository } from "./fakes";

function makeEvent(overrides: Partial<DomainEvent> = {}): DomainEvent {
  return createDomainEvent({
    type: "organization.created",
    organizationId: "org-1",
    actorUserId: "user-1",
    payload: { organizationId: "org-1" },
    ...overrides,
  });
}

function createWorker(handlers: Parameters<typeof createOutboxWorker>[0]["handlers"] = {}) {
  const { outbox, outboxStore } = createFakeOutboxRepository();
  const worker = createOutboxWorker({ outbox, handlers });
  return { worker, outbox, outboxStore };
}

describe("outbox worker (fake repository)", () => {
  test("poll processes due events with a registered handler and marks them succeeded", async () => {
    const seen: string[] = [];
    const { worker, outbox, outboxStore } = createWorker({
      "organization.created": async (event) => {
        seen.push(event.id);
      },
    });
    await outbox.append(makeEvent());

    const result = await worker.poll(10);

    expect(result).toEqual({ processed: 1, succeeded: 1, failed: 0 });
    expect(seen).toEqual([outboxStore[0]?.eventId as string]);
    expect(outboxStore[0]).toMatchObject({ status: "succeeded", attempts: 0 });
  });

  test("poll respects the limit", async () => {
    const { worker, outbox } = createWorker({
      "organization.created": async () => {},
    });
    await outbox.append(makeEvent());
    await outbox.append(makeEvent());
    await outbox.append(makeEvent());

    const result = await worker.poll(2);

    expect(result).toEqual({ processed: 2, succeeded: 2, failed: 0 });
  });

  test("a throwing handler marks the event failed with attempts +1", async () => {
    const { worker, outbox, outboxStore } = createWorker({
      "organization.created": async () => {
        throw new Error("boom");
      },
    });
    await outbox.append(makeEvent());

    const result = await worker.poll(10);

    expect(result).toEqual({ processed: 1, succeeded: 0, failed: 1 });
    expect(outboxStore[0]).toMatchObject({
      status: "failed",
      attempts: 1,
      lastError: "boom",
    });
  });

  test("an unknown event type fails with 'no handler for type X'", async () => {
    const { worker, outbox, outboxStore } = createWorker({});
    await outbox.append(makeEvent({ type: "member.invited" }));

    const result = await worker.poll(10);

    expect(result).toEqual({ processed: 1, succeeded: 0, failed: 1 });
    expect(outboxStore[0]).toMatchObject({
      status: "failed",
      attempts: 1,
      lastError: "no handler for type member.invited",
    });
  });

  test("repeated handler failures dead-letter the event after max attempts", async () => {
    const { worker, outbox, outboxStore } = createWorker({
      "organization.created": async () => {
        throw new Error("always fails");
      },
    });
    await outbox.append(makeEvent());

    for (let i = 1; i <= 5; i += 1) {
      const result = await worker.poll(10);
      expect(result).toEqual({ processed: 1, succeeded: 0, failed: 1 });
      const record = outboxStore[0] as { status: string };
      if (i < 5) {
        // The event becomes retryable again once its backoff window has passed.
        expect(record.status).toBe("failed");
        const requeued = outboxStore[0] as {
          status: "pending";
          nextAttemptAt: Date;
        };
        requeued.status = "pending";
        requeued.nextAttemptAt = new Date(Date.now() - 1_000);
      }
    }

    expect(outboxStore[0]).toMatchObject({ status: "dead_letter", attempts: 5 });
    expect((await worker.poll(10)).processed).toBe(0);
  });

  test("markFailed applies exponential backoff to nextAttemptAt", async () => {
    const { worker, outbox, outboxStore } = createWorker({
      "organization.created": async () => {
        throw new Error("boom");
      },
    });
    await outbox.append(makeEvent());
    const before = Date.now();

    await worker.poll(10);

    const record = outboxStore[0];
    expect(record?.status).toBe("failed");
    expect(record?.nextAttemptAt.getTime()).toBeGreaterThan(before + 500);
    expect(record?.nextAttemptAt.getTime()).toBeLessThanOrEqual(before + 60 * 60 * 1_000);
  });

  test("poll does not pick up events that are not yet due (backoff honored)", async () => {
    const { worker, outbox } = createWorker({
      "organization.created": async () => {
        throw new Error("boom");
      },
    });
    await outbox.append(makeEvent());
    await worker.poll(10);

    const again = await worker.poll(10);

    expect(again).toEqual({ processed: 0, succeeded: 0, failed: 0 });
  });

  test("reprocess resets a dead-lettered event to pending and it can succeed afterwards", async () => {
    let fail = true;
    const { worker, outbox, outboxStore } = createWorker({
      "organization.created": async () => {
        if (fail) {
          throw new Error("boom");
        }
      },
    });
    await outbox.append(makeEvent());
    for (let i = 1; i <= 5; i += 1) {
      await worker.poll(10);
      if (i < 5) {
        const record = outboxStore[0] as { status: "pending"; nextAttemptAt: Date };
        record.status = "pending";
        record.nextAttemptAt = new Date(Date.now() - 1_000);
      }
    }
    expect(outboxStore[0]).toMatchObject({ status: "dead_letter" });

    const reprocessed = await worker.reprocess(outboxStore[0]?.eventId as string);

    expect(reprocessed).toMatchObject({
      eventId: outboxStore[0]?.eventId,
      status: "pending",
      attempts: 0,
      lastError: null,
    });

    fail = false;
    const result = await worker.poll(10);

    expect(result).toEqual({ processed: 1, succeeded: 1, failed: 0 });
    expect(outboxStore[0]).toMatchObject({ status: "succeeded", attempts: 0 });
  });

  test("poll increments metrics counters when metrics are provided (success)", async () => {
    const counters: Record<string, number> = {};
    const metrics = {
      incrementCounter: (name: string, value = 1) => {
        counters[name] = (counters[name] ?? 0) + value;
      },
    };
    const { outbox } = createFakeOutboxRepository();
    const worker = createOutboxWorker({
      outbox,
      handlers: { "organization.created": async () => {} },
      metrics,
    });
    await outbox.append(makeEvent());

    const result = await worker.poll(10);

    expect(result).toEqual({ processed: 1, succeeded: 1, failed: 0 });
    expect(counters).toEqual({ outbox_processed_total: 1, outbox_succeeded_total: 1 });
  });

  test("poll increments failure counters when a handler throws", async () => {
    const counters: Record<string, number> = {};
    const metrics = {
      incrementCounter: (name: string, value = 1) => {
        counters[name] = (counters[name] ?? 0) + value;
      },
    };
    const { outbox } = createFakeOutboxRepository();
    const worker = createOutboxWorker({
      outbox,
      handlers: {
        "organization.created": async () => {
          throw new Error("boom");
        },
      },
      metrics,
    });
    await outbox.append(makeEvent());

    const result = await worker.poll(10);

    expect(result).toEqual({ processed: 1, succeeded: 0, failed: 1 });
    expect(counters).toEqual({ outbox_processed_total: 1, outbox_failed_total: 1 });
  });

  test("reprocess throws OutboxEventNotFoundError for an unknown eventId", async () => {
    const { worker } = createWorker({});

    await expect(worker.reprocess("missing-event")).rejects.toThrow("Outbox event not found");
  });

  test("pendingCount returns the number of pending events", async () => {
    const { worker, outbox } = createWorker({
      "organization.created": async () => {},
    });
    await outbox.append(makeEvent());
    await outbox.append(makeEvent());

    expect(await worker.pendingCount()).toBe(2);

    await worker.poll(10);

    expect(await worker.pendingCount()).toBe(0);
  });
});
