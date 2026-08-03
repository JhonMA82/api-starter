export type JobStatus = "pending" | "running" | "succeeded" | "failed" | "cancelled";

export interface Job {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  runAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export function isJobRetryable(job: Job, now: Date): boolean {
  return (
    (job.status === "failed" || job.status === "pending") &&
    job.attempts < job.maxAttempts &&
    job.runAt.getTime() <= now.getTime()
  );
}
