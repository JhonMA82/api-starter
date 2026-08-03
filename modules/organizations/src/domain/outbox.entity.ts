export type OutboxStatus = "pending" | "processing" | "succeeded" | "failed" | "dead_letter";

export interface OutboxRecord {
  id: string;
  eventId: string;
  type: string;
  organizationId: string;
  actorUserId: string;
  payload: Record<string, unknown>;
  status: OutboxStatus;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  nextAttemptAt: Date;
  processedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export function isOutboxRetryable(record: OutboxRecord, now: Date): boolean {
  return (
    (record.status === "failed" || record.status === "dead_letter") &&
    record.attempts < record.maxAttempts &&
    record.nextAttemptAt.getTime() <= now.getTime()
  );
}
