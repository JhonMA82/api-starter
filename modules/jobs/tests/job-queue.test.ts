import { describe, expect, test } from "bun:test";
import { isJobRetryable, type Job } from "../src/domain/job.entity";
import { JobNotFoundError } from "../src/domain/job.errors";
import { createInMemoryJobQueue } from "../src/infrastructure";

function makeJob(overrides: Partial<Job> = {}): Job {
  const now = new Date("2026-08-03T12:00:00.000Z");
  return {
    id: "job-1",
    type: "email.send",
    payload: { to: "a@example.com" },
    status: "pending",
    attempts: 0,
    maxAttempts: 5,
    lastError: null,
    runAt: now,
    startedAt: null,
    finishedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("createInMemoryJobQueue", () => {
  test("enqueue creates a pending job with runAt now", async () => {
    const queue = createInMemoryJobQueue();

    const job = await queue.enqueue({ type: "email.send", payload: { to: "a@example.com" } });

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
    expect(job.runAt).toBeInstanceOf(Date);
    expect(job.runAt.getTime()).toBeLessThanOrEqual(Date.now());
  });

  test("schedule creates a pending job with the given runAt", async () => {
    const queue = createInMemoryJobQueue();
    const runAt = new Date("2026-08-04T00:00:00.000Z");

    const job = await queue.schedule({
      type: "reminder.due",
      payload: { noteId: "n-1" },
      runAt,
    });

    expect(job.runAt).toEqual(runAt);
    expect(job.status).toBe("pending");
  });

  test("cancel transitions the job to cancelled", async () => {
    const queue = createInMemoryJobQueue();
    const job = await queue.enqueue({ type: "email.send", payload: {} });

    const cancelled = await queue.cancel(job.id);

    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.finishedAt).toBeInstanceOf(Date);
    expect(cancelled.updatedAt).toEqual(cancelled.finishedAt as Date);
  });

  test("cancel throws JobNotFoundError for an unknown id", async () => {
    const queue = createInMemoryJobQueue();

    await expect(queue.cancel("missing-id")).rejects.toThrow(JobNotFoundError);
  });

  test("enqueued jobs are independent (distinct ids)", async () => {
    const queue = createInMemoryJobQueue();

    const first = await queue.enqueue({ type: "email.send", payload: {} });
    const second = await queue.enqueue({ type: "email.send", payload: {} });

    expect(first.id).not.toBe(second.id);
  });
});

describe("isJobRetryable", () => {
  const now = new Date("2026-08-03T12:00:00.000Z");

  test("failed with attempts below max and due is retryable", () => {
    expect(
      isJobRetryable(makeJob({ status: "failed", attempts: 2, maxAttempts: 5, runAt: now }), now),
    ).toBe(true);
  });

  test("pending with attempts below max and due is retryable", () => {
    expect(isJobRetryable(makeJob({ status: "pending", attempts: 0, runAt: now }), now)).toBe(true);
  });

  test("attempts at or above max is not retryable", () => {
    expect(
      isJobRetryable(makeJob({ status: "failed", attempts: 5, maxAttempts: 5, runAt: now }), now),
    ).toBe(false);
  });

  test("running/succeeded/cancelled are not retryable", () => {
    for (const status of ["running", "succeeded", "cancelled"] as const) {
      expect(isJobRetryable(makeJob({ status }), now)).toBe(false);
    }
  });

  test("not yet due is not retryable", () => {
    expect(
      isJobRetryable(
        makeJob({
          status: "failed",
          attempts: 1,
          maxAttempts: 5,
          runAt: new Date(now.getTime() + 60_000),
        }),
        now,
      ),
    ).toBe(false);
  });
});
