import { describe, expect, test } from "bun:test";

import { createOrganizationUseCase } from "../src/application/create-organization";
import { createDomainEvent, type DomainEvent } from "../src/domain/domain-events";
import { isOutboxRetryable, type OutboxRecord } from "../src/domain/outbox.entity";
import { createFakeOutboxRepository, createFakeRepositories, createFakeUnitOfWork } from "./fakes";

function makeEvent(overrides: Partial<DomainEvent> = {}): DomainEvent {
  return createDomainEvent({
    type: "organization.created",
    organizationId: "org-1",
    actorUserId: "user-1",
    payload: { organizationId: "org-1", slug: "acme-inc", name: "Acme Inc" },
    ...overrides,
  });
}

function makeRecord(overrides: Partial<OutboxRecord> = {}): OutboxRecord {
  const now = new Date();
  return {
    id: "outbox-1",
    eventId: "event-1",
    type: "organization.created",
    organizationId: "org-1",
    actorUserId: "user-1",
    payload: {},
    status: "pending",
    attempts: 0,
    maxAttempts: 5,
    lastError: null,
    nextAttemptAt: now,
    processedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("createDomainEvent", () => {
  test("generates a unique uuid id and ISO timestamp", () => {
    const first = createDomainEvent({
      type: "organization.created",
      organizationId: "org-1",
      actorUserId: "user-1",
      payload: {},
    });
    const second = createDomainEvent({
      type: "organization.created",
      organizationId: "org-1",
      actorUserId: "user-1",
      payload: {},
    });

    expect(first.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(first.id).not.toBe(second.id);
    expect(first.type).toBe("organization.created");
    expect(first.occurredAt).toBeInstanceOf(Date);
  });
});

describe("fake outbox repository", () => {
  test("append stores a pending event with the passed fields", async () => {
    const { outbox, outboxStore } = createFakeOutboxRepository();
    const event = makeEvent();

    await outbox.append(event);

    expect(outboxStore).toHaveLength(1);
    expect(outboxStore[0]).toMatchObject({
      eventId: event.id,
      type: "organization.created",
      organizationId: "org-1",
      actorUserId: "user-1",
      payload: { organizationId: "org-1", slug: "acme-inc", name: "Acme Inc" },
      status: "pending",
      attempts: 0,
      maxAttempts: 5,
      lastError: null,
      processedAt: null,
    });
  });

  test("append with a duplicate eventId is a no-op", async () => {
    const { outbox, outboxStore } = createFakeOutboxRepository();
    const event = makeEvent();

    await outbox.append(event);
    await outbox.append(event);

    expect(outboxStore).toHaveLength(1);
  });

  test("findPendingDue returns due pending events ordered by createdAt", async () => {
    const { outbox } = createFakeOutboxRepository();
    const first = makeEvent();
    const second = makeEvent();
    await outbox.append(first);
    await outbox.append(second);

    const due = await outbox.findPendingDue(10);

    expect(due.map((record) => record.eventId)).toEqual([first.id, second.id]);
  });

  test("findPendingDue respects the limit", async () => {
    const { outbox } = createFakeOutboxRepository();
    await outbox.append(makeEvent());
    await outbox.append(makeEvent());
    await outbox.append(makeEvent());

    const due = await outbox.findPendingDue(2);

    expect(due).toHaveLength(2);
  });

  test("markFailed increments attempts and dead-letters at max_attempts", async () => {
    const { outbox, outboxStore } = createFakeOutboxRepository();
    await outbox.append(makeEvent());
    const record = outboxStore[0] as OutboxRecord;

    await outbox.markFailed(record.id, "first error");
    expect(outboxStore[0]).toMatchObject({
      status: "failed",
      attempts: 1,
      lastError: "first error",
    });

    for (let i = 2; i <= 5; i += 1) {
      await outbox.markFailed(record.id, `error ${i}`);
    }
    expect(outboxStore[0]).toMatchObject({ status: "dead_letter", attempts: 5 });
  });

  test("reprocess resets dead_letter to pending with attempts 0", async () => {
    const { outbox, outboxStore } = createFakeOutboxRepository();
    await outbox.append(makeEvent());
    const record = outboxStore[0] as OutboxRecord;
    for (let i = 0; i < 5; i += 1) {
      await outbox.markFailed(record.id, "error");
    }
    expect(outboxStore[0]?.status).toBe("dead_letter");

    await outbox.reprocess(record.id);

    expect(outboxStore[0]).toMatchObject({
      status: "pending",
      attempts: 0,
      lastError: null,
      processedAt: null,
    });
  });

  test("markProcessing and markSucceeded transition the status", async () => {
    const { outbox, outboxStore } = createFakeOutboxRepository();
    await outbox.append(makeEvent());
    const record = outboxStore[0] as OutboxRecord;

    await outbox.markProcessing(record.id);
    expect(outboxStore[0]?.status).toBe("processing");

    await outbox.markSucceeded(record.id);
    expect(outboxStore[0]).toMatchObject({
      status: "succeeded",
      attempts: 0,
    });
    expect(outboxStore[0]?.processedAt).toBeInstanceOf(Date);
  });
});

describe("isOutboxRetryable", () => {
  const now = new Date("2026-08-03T12:00:00.000Z");

  test("failed with attempts below max is retryable", () => {
    expect(
      isOutboxRetryable(
        makeRecord({ status: "failed", attempts: 2, maxAttempts: 5, nextAttemptAt: now }),
        now,
      ),
    ).toBe(true);
  });

  test("dead_letter with attempts below max is retryable", () => {
    expect(
      isOutboxRetryable(
        makeRecord({
          status: "dead_letter",
          attempts: 4,
          maxAttempts: 5,
          nextAttemptAt: now,
        }),
        now,
      ),
    ).toBe(true);
  });

  test("attempts at or above max is not retryable", () => {
    expect(
      isOutboxRetryable(
        makeRecord({ status: "failed", attempts: 5, maxAttempts: 5, nextAttemptAt: now }),
        now,
      ),
    ).toBe(false);
  });

  test("pending/processing/succeeded are not retryable", () => {
    for (const status of ["pending", "processing", "succeeded"] as const) {
      expect(isOutboxRetryable(makeRecord({ status }), now)).toBe(false);
    }
  });

  test("not yet due is not retryable", () => {
    expect(
      isOutboxRetryable(
        makeRecord({
          status: "failed",
          attempts: 1,
          maxAttempts: 5,
          nextAttemptAt: new Date(now.getTime() + 60_000),
        }),
        now,
      ),
    ).toBe(false);
  });
});

describe("createOrganizationUseCase emits organization.created", () => {
  test("appends the event inside uow.run when a uow is provided", async () => {
    const repos = createFakeRepositories();
    const { uow, calls } = createFakeUnitOfWork(repos);
    const useCase = createOrganizationUseCase({
      organizations: repos.organizations,
      memberships: repos.memberships,
      uow,
    });

    const org = await useCase({ name: "Acme Inc", slug: "acme-inc", ownerUserId: "user-1" });

    expect(calls).toEqual(["run", "organizations.create", "memberships.create", "outbox.append"]);
    expect(repos.outboxStore).toHaveLength(1);
    expect(repos.outboxStore[0]).toMatchObject({
      type: "organization.created",
      organizationId: org.id,
      actorUserId: "user-1",
      payload: { organizationId: org.id, slug: "acme-inc", name: "Acme Inc" },
      status: "pending",
    });
  });

  test("emits no event when no uow is provided", async () => {
    const repos = createFakeRepositories();
    const useCase = createOrganizationUseCase({
      organizations: repos.organizations,
      memberships: repos.memberships,
    });

    await useCase({ name: "Acme Inc", slug: "acme-inc", ownerUserId: "user-1" });

    expect(repos.outboxStore).toHaveLength(0);
    expect(repos.organizationStore.size).toBe(1);
  });

  test("rejects a duplicate slug before emitting anything", async () => {
    const repos = createFakeRepositories();
    const { uow, calls } = createFakeUnitOfWork(repos);
    const useCase = createOrganizationUseCase({
      organizations: repos.organizations,
      memberships: repos.memberships,
      uow,
    });
    await repos.organizations.create({ name: "Acme Inc", slug: "acme-inc" });

    await expect(
      useCase({ name: "Other", slug: "acme-inc", ownerUserId: "user-2" }),
    ).rejects.toThrow();

    expect(calls).toEqual([]);
    expect(repos.outboxStore).toHaveLength(0);
  });
});
