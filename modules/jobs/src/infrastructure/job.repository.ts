import { and, asc, eq, lte, sql } from "drizzle-orm";

import type { JobRepository } from "../application/ports";
import type { Job, JobStatus } from "../domain/job.entity";
import { JobNotFoundError } from "../domain/job.errors";
import type { DbOrTransaction } from "./db";
import { jobs } from "./job.schema";

export function createJobRepository(db: DbOrTransaction): JobRepository {
  return {
    async create(input) {
      const [row] = await db
        .insert(jobs)
        .values({ type: input.type, payload: input.payload, runAt: input.runAt })
        .returning();
      if (row === undefined) {
        throw new Error("insert returned no rows");
      }
      return rowToJob(row);
    },
    async findDue(limit, now) {
      const rows = await db
        .select()
        .from(jobs)
        .where(and(eq(jobs.status, "pending"), lte(jobs.runAt, now)))
        .orderBy(asc(jobs.runAt))
        .limit(limit);
      return rows.map(rowToJob);
    },
    async findById(id) {
      const [row] = await db.select().from(jobs).where(eq(jobs.id, id));
      return row === undefined ? null : rowToJob(row);
    },
    async claim(jobId) {
      const [row] = await db
        .update(jobs)
        .set({ status: "running", startedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(jobs.id, jobId), eq(jobs.status, "pending")))
        .returning();
      if (row === undefined) {
        throw new JobNotFoundError(jobId);
      }
      return rowToJob(row);
    },
    async finish(jobId) {
      const [row] = await db
        .update(jobs)
        .set({ status: "succeeded", finishedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(jobs.id, jobId), eq(jobs.status, "running")))
        .returning();
      if (row === undefined) {
        throw new JobNotFoundError(jobId);
      }
      return rowToJob(row);
    },
    async fail(jobId, error) {
      const [row] = await db
        .update(jobs)
        .set({
          status: "failed",
          attempts: sql`${jobs.attempts} + 1`,
          lastError: error,
          finishedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(jobs.id, jobId), eq(jobs.status, "running")))
        .returning();
      if (row === undefined) {
        throw new JobNotFoundError(jobId);
      }
      return rowToJob(row);
    },
    async cancel(jobId) {
      const [row] = await db
        .update(jobs)
        .set({ status: "cancelled", finishedAt: new Date(), updatedAt: new Date() })
        .where(eq(jobs.id, jobId))
        .returning();
      if (row === undefined) {
        throw new JobNotFoundError(jobId);
      }
      return rowToJob(row);
    },
    async listByStatus(status, limit) {
      const rows = await db
        .select()
        .from(jobs)
        .where(eq(jobs.status, status))
        .orderBy(asc(jobs.createdAt))
        .limit(limit);
      return rows.map(rowToJob);
    },
  };
}

function rowToJob(row: typeof jobs.$inferSelect): Job {
  return {
    id: row.id,
    type: row.type,
    payload: row.payload,
    status: row.status as JobStatus,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    lastError: row.lastError,
    runAt: row.runAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
