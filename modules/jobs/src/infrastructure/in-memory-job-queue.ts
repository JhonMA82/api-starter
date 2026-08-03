import type { JobQueue } from "../application/ports";
import type { Job } from "../domain/job.entity";
import { JobNotFoundError } from "../domain/job.errors";

/**
 * In-memory JobQueue — for tests only. Not for production use.
 */
export function createInMemoryJobQueue(): JobQueue {
  const store = new Map<string, Job>();
  return {
    async enqueue(input) {
      const now = new Date();
      const job: Job = {
        id: crypto.randomUUID(),
        type: input.type,
        payload: input.payload,
        status: "pending",
        attempts: 0,
        maxAttempts: 5,
        lastError: null,
        runAt: now,
        startedAt: null,
        finishedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      store.set(job.id, job);
      return job;
    },
    async schedule(input) {
      const now = new Date();
      const job: Job = {
        id: crypto.randomUUID(),
        type: input.type,
        payload: input.payload,
        status: "pending",
        attempts: 0,
        maxAttempts: 5,
        lastError: null,
        runAt: input.runAt,
        startedAt: null,
        finishedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      store.set(job.id, job);
      return job;
    },
    async cancel(jobId) {
      const job = store.get(jobId);
      if (job === undefined) {
        throw new JobNotFoundError(jobId);
      }
      const updated: Job = {
        ...job,
        status: "cancelled",
        finishedAt: new Date(),
        updatedAt: new Date(),
      };
      store.set(jobId, updated);
      return updated;
    },
  };
}
