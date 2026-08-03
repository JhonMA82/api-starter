import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  closeClient,
  createTestClient,
  getDatabaseUrl,
  migrateToLatest,
  resetDatabase,
} from "../../notes/tests/db-test-utils";
import { createDomainEvent } from "../src/domain/domain-events";
import { createDb, createOutboxRepository } from "../src/infrastructure";

const databaseUrl = getDatabaseUrl();
const describeDb = databaseUrl === null ? describe.skip : describe;
if (databaseUrl === null) {
  console.warn("[organizations outbox tests] DATABASE_URL is not set — skipping real-DB tests");
}

describeDb("outbox repository (real database)", () => {
  const client = createTestClient(databaseUrl as string);

  beforeAll(async () => {
    await resetDatabase(client);
    await migrateToLatest(client);
  });

  afterAll(async () => {
    await closeClient(client);
  });

  test("append stores a pending event and findPendingDue returns it", async () => {
    const repository = createOutboxRepository(createDb(client));
    const event = createDomainEvent({
      type: "organization.created",
      organizationId: "org-1",
      actorUserId: "user-1",
      payload: { organizationId: "org-1", slug: "acme-inc", name: "Acme Inc" },
    });

    await repository.append(event);

    const due = await repository.findPendingDue(10);
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({
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
    expect(due[0]?.nextAttemptAt).toBeInstanceOf(Date);
    expect(due[0]?.createdAt).toBeInstanceOf(Date);
  });

  test("append with a duplicate eventId keeps a single row (onConflictDoNothing)", async () => {
    const repository = createOutboxRepository(createDb(client));
    const event = createDomainEvent({
      type: "organization.created",
      organizationId: "org-2",
      actorUserId: "user-1",
      payload: {},
    });

    await repository.append(event);
    await repository.append(event);

    const due = await repository.findPendingDue(10);
    const matches = due.filter((record) => record.eventId === event.id);
    expect(matches).toHaveLength(1);
  });

  test("markProcessing transitions the row to processing", async () => {
    const repository = createOutboxRepository(createDb(client));
    const event = createDomainEvent({
      type: "organization.created",
      organizationId: "org-3",
      actorUserId: "user-1",
      payload: {},
    });
    await repository.append(event);
    const record = (await repository.findPendingDue(10)).find((r) => r.eventId === event.id);
    expect(record).toBeDefined();

    await repository.markProcessing(record?.id as string);

    const byStatus = await repository.listByStatus("processing", 10);
    expect(byStatus.some((row) => row.eventId === event.id)).toBe(true);
  });

  test("markSucceeded transitions the row to succeeded with processedAt", async () => {
    const repository = createOutboxRepository(createDb(client));
    const event = createDomainEvent({
      type: "organization.created",
      organizationId: "org-4",
      actorUserId: "user-1",
      payload: {},
    });
    await repository.append(event);
    const record = (await repository.findPendingDue(10)).find((r) => r.eventId === event.id);

    await repository.markSucceeded(record?.id as string);

    const succeeded = await repository.listByStatus("succeeded", 10);
    const row = succeeded.find((r) => r.eventId === event.id);
    expect(row).toBeDefined();
    expect(row?.status).toBe("succeeded");
    expect(row?.processedAt).toBeInstanceOf(Date);
  });

  test("markFailed increments attempts and dead-letters at max_attempts", async () => {
    const repository = createOutboxRepository(createDb(client));
    const event = createDomainEvent({
      type: "organization.created",
      organizationId: "org-5",
      actorUserId: "user-1",
      payload: {},
    });
    await repository.append(event);
    const record = (await repository.findPendingDue(10)).find((r) => r.eventId === event.id);

    await repository.markFailed(record?.id as string, "boom 1");
    const failed = await repository.listByStatus("failed", 10);
    expect(failed.find((r) => r.eventId === event.id)).toMatchObject({
      eventId: event.id,
      attempts: 1,
      lastError: "boom 1",
    });

    for (let i = 2; i <= 5; i += 1) {
      await repository.markFailed(record?.id as string, `boom ${i}`);
    }
    const deadLetters = await repository.listByStatus("dead_letter", 10);
    expect(deadLetters.find((r) => r.eventId === event.id)).toMatchObject({
      eventId: event.id,
      attempts: 5,
    });
    expect((await repository.listByStatus("failed", 10)).some((r) => r.eventId === event.id)).toBe(
      false,
    );
  });

  test("reprocess resets dead_letter to pending with attempts 0", async () => {
    const repository = createOutboxRepository(createDb(client));
    const event = createDomainEvent({
      type: "organization.created",
      organizationId: "org-6",
      actorUserId: "user-1",
      payload: {},
    });
    await repository.append(event);
    const record = (await repository.findPendingDue(10)).find((r) => r.eventId === event.id);
    for (let i = 0; i < 5; i += 1) {
      await repository.markFailed(record?.id as string, "boom");
    }
    expect(
      (await repository.listByStatus("dead_letter", 10)).some((r) => r.eventId === event.id),
    ).toBe(true);

    await repository.reprocess(record?.id as string);

    const pending = await repository.listByStatus("pending", 10);
    expect(pending.find((r) => r.eventId === event.id)).toMatchObject({
      eventId: event.id,
      status: "pending",
      attempts: 0,
      lastError: null,
      processedAt: null,
    });
    expect(
      (await repository.listByStatus("dead_letter", 10)).some((r) => r.eventId === event.id),
    ).toBe(false);
  });
});
