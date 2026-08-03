import type { Job, JobStatus } from "../domain/job.entity";

export interface JobQueue {
  enqueue(input: { type: string; payload: Record<string, unknown> }): Promise<Job>;
  schedule(input: { type: string; payload: Record<string, unknown>; runAt: Date }): Promise<Job>;
  cancel(jobId: string): Promise<Job>;
}

export interface JobRepository {
  create(input: { type: string; payload: Record<string, unknown>; runAt: Date }): Promise<Job>;
  findDue(limit: number, now: Date): Promise<Job[]>;
  findById(id: string): Promise<Job | null>;
  claim(jobId: string): Promise<Job>;
  finish(jobId: string): Promise<Job>;
  fail(jobId: string, error: string): Promise<Job>;
  cancel(jobId: string): Promise<Job>;
  listByStatus(status: JobStatus, limit: number): Promise<Job[]>;
}
