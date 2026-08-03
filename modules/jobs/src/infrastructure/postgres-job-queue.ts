import type { JobQueue } from "../application/ports";
import type { DbOrTransaction } from "./db";
import { createJobRepository } from "./job.repository";

export function createPostgresJobQueue(db: DbOrTransaction): JobQueue {
  const repository = createJobRepository(db);
  return {
    async enqueue(input) {
      return repository.create({ type: input.type, payload: input.payload, runAt: new Date() });
    },
    async schedule(input) {
      return repository.create({ type: input.type, payload: input.payload, runAt: input.runAt });
    },
    async cancel(jobId) {
      return repository.cancel(jobId);
    },
  };
}
