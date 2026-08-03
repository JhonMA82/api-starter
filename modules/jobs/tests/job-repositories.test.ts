import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  closeClient,
  createTestClient,
  getDatabaseUrl,
  migrateToLatest,
  resetDatabase,
} from "../../notes/tests/db-test-utils";
import type { Job } from "../src/domain/job.entity";
import { JobNotFoundError } from "../src/domain/job.errors";
import { createDb, createJobRepository, createPostgresJobQueue } from "../src/infrastructure";

const databaseUrl = getDatabaseUrl();
const describeDb = databaseUrl === null ? describe.skip : describe;
if (databaseUrl === null) {
  console.warn("[jobs tests] DATABASE_URL is not set — skipping real-DB tests");
}

describeDb("job repository (real database)", () => {
  const client = createTestClient(databaseUrl as string);

  beforeAll(async () => {
    await resetDatabase(client);
    await migrateToLatest(client);
  });

  afterAll(async () => {
    await closeClient(client);
  });

  test("create stores a pending job and findDue returns it", async () => {
    const repository = createJobRepository(createDb(client));

    const job = await repository.create({
      type: "email.send",
      payload: { to: "a@example.com" },
      runAt: new Date(),
    });

    expect(job).toMatchObject({
      type: "email.send",
      payload: { to: "a@example.com" },
      status: "pending",
      attempts: 0,
      maxAttempts: 5,
      lastError: null,
      startedAt: null,
      finishedAt: null,
    });
    expect(job.id).toMatch(/^[0-9a-f-]{36}$/);

    const due = await repository.findDue(10, new Date());
    expect(due.some((row) => row.id === job.id)).toBe(true);
  });

  test("findDue excludes jobs scheduled in the future, orders by runAt, and honors the limit", async () => {
    const repository = createJobRepository(createDb(client));
    const future = await repository.create({
      type: "reminder.due",
      payload: {},
      runAt: new Date(Date.now() + 60_000),
    });
    const past = new Date(Date.now() - 10_000);
    const near = new Date(Date.now() - 5_000);
    const first = await repository.create({ type: "email.send", payload: {}, runAt: past });
    const second = await repository.create({ type: "email.send", payload: {}, runAt: near });

    const due = await repository.findDue(10, new Date());
    const dueIds = new Set(due.map((row) => row.id));

    expect(dueIds.has(future.id)).toBe(false);
    expect(dueIds.has(first.id)).toBe(true);
    expect(dueIds.has(second.id)).toBe(true);
    const firstIdx = due.findIndex((row) => row.id === first.id);
    const secondIdx = due.findIndex((row) => row.id === second.id);
    expect(firstIdx).toBeLessThan(secondIdx);

    const limited = await repository.findDue(1, new Date());
    expect(limited).toHaveLength(1);
  });

  test("findById returns null for an unknown id", async () => {
    const repository = createJobRepository(createDb(client));

    expect(await repository.findById("00000000-0000-0000-0000-000000000000")).toBeNull();
  });

  test("claim transitions pending to running and rejects a second claim", async () => {
    const repository = createJobRepository(createDb(client));
    const job = await repository.create({ type: "email.send", payload: {}, runAt: new Date() });

    const running = await repository.claim(job.id);

    expect(running.status).toBe("running");
    expect(running.startedAt).toBeInstanceOf(Date);

    await expect(repository.claim(job.id)).rejects.toThrow(JobNotFoundError);
  });

  test("claim throws JobNotFoundError for an unknown id", async () => {
    const repository = createJobRepository(createDb(client));

    await expect(repository.claim("00000000-0000-0000-0000-000000000000")).rejects.toThrow(
      JobNotFoundError,
    );
  });

  test("finish transitions a running job to succeeded with finishedAt", async () => {
    const repository = createJobRepository(createDb(client));
    const job = await repository.create({ type: "email.send", payload: {}, runAt: new Date() });
    await repository.claim(job.id);

    const finished = await repository.finish(job.id);

    expect(finished.status).toBe("succeeded");
    expect(finished.finishedAt).toBeInstanceOf(Date);
  });

  test("finish on a pending job throws JobNotFoundError (running-only)", async () => {
    const repository = createJobRepository(createDb(client));
    const job = await repository.create({ type: "email.send", payload: {}, runAt: new Date() });

    await expect(repository.finish(job.id)).rejects.toThrow(JobNotFoundError);
  });

  test("fail transitions a running job to failed with attempts +1 (failed is terminal)", async () => {
    const repository = createJobRepository(createDb(client));
    const job = await repository.create({ type: "email.send", payload: {}, runAt: new Date() });
    await repository.claim(job.id);

    const failed = await repository.fail(job.id, "boom");

    expect(failed.status).toBe("failed");
    expect(failed.attempts).toBe(1);
    expect(failed.lastError).toBe("boom");
    expect(failed.finishedAt).toBeInstanceOf(Date);

    // failed is terminal for jobs: no claim/finish/fail from failed.
    await expect(repository.claim(job.id)).rejects.toThrow(JobNotFoundError);
    await expect(repository.finish(job.id)).rejects.toThrow(JobNotFoundError);
    await expect(repository.fail(job.id, "boom again")).rejects.toThrow(JobNotFoundError);
  });

  test("cancel transitions a pending job to cancelled", async () => {
    const repository = createJobRepository(createDb(client));
    const job = await repository.create({ type: "email.send", payload: {}, runAt: new Date() });

    const cancelled = await repository.cancel(job.id);

    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.finishedAt).toBeInstanceOf(Date);
  });

  test("cancel throws JobNotFoundError for an unknown id", async () => {
    const repository = createJobRepository(createDb(client));

    await expect(repository.cancel("00000000-0000-0000-0000-000000000000")).rejects.toThrow(
      JobNotFoundError,
    );
  });

  test("listByStatus returns jobs of the given status ordered by createdAt", async () => {
    const repository = createJobRepository(createDb(client));
    const job = await repository.create({ type: "email.send", payload: {}, runAt: new Date() });
    await repository.claim(job.id);
    await repository.finish(job.id);

    const succeeded = await repository.listByStatus("succeeded", 10);
    const row = succeeded.find((candidate) => candidate.id === job.id);

    expect(row).toBeDefined();
    expect(row?.status).toBe("succeeded");
    expect(succeeded).toEqual(
      [...succeeded].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
    );
  });

  test("PostgresJobQueue: enqueue -> findDue -> claim -> finish", async () => {
    const db = createDb(client);
    const queue = createPostgresJobQueue(db);
    const repository = createJobRepository(db);

    const job = await queue.enqueue({ type: "email.send", payload: { to: "b@example.com" } });
    expect(job.status).toBe("pending");

    const due = await repository.findDue(10, new Date());
    expect(due.some((row) => row.id === job.id)).toBe(true);

    const running = await repository.claim(job.id);
    expect(running.status).toBe("running");

    const finished = await repository.finish(job.id);
    expect(finished.status).toBe("succeeded");
  });

  test("PostgresJobQueue: schedule and cancel", async () => {
    const db = createDb(client);
    const queue = createPostgresJobQueue(db);
    const runAt = new Date(Date.now() + 60_000);

    const job = await queue.schedule({ type: "reminder.due", payload: { noteId: "n-1" }, runAt });
    expect(job.runAt.getTime()).toBeGreaterThanOrEqual(runAt.getTime() - 1_000);

    const cancelled = await queue.cancel(job.id);
    expect(cancelled.status).toBe("cancelled");

    await expect(queue.cancel("00000000-0000-0000-0000-000000000000")).rejects.toThrow(
      JobNotFoundError,
    );
  });

  test("jobs table integration: enqueued job rows round-trip as Job entities", async () => {
    const repository = createJobRepository(createDb(client));
    const job: Job = await repository.create({
      type: "audit.report",
      payload: { organizationId: "org-1", nested: { ok: true } },
      runAt: new Date(),
    });

    const found = await repository.findById(job.id);

    expect(found).not.toBeNull();
    expect(found?.payload).toEqual({ organizationId: "org-1", nested: { ok: true } });
    expect(found?.createdAt).toBeInstanceOf(Date);
    expect(found?.updatedAt).toBeInstanceOf(Date);
  });
});
