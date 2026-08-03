import { desc } from "drizzle-orm";

import { auditLog } from "./audit.schema";
import type { AuditDb } from "./db";

export type AuditEntryInput = {
  actorUserId?: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  outcome: string;
  metadata?: Record<string, unknown>;
};

export type AuditEntry = {
  id: string;
  actorUserId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  outcome: string;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
};

export type AuditLogger = {
  record(input: AuditEntryInput): Promise<void>;
  list(options?: { limit?: number }): Promise<AuditEntry[]>;
};

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;

function assertNotBlank(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw new RangeError(`${field} must not be blank`);
  }
}

export function createAuditLogger(db: AuditDb): AuditLogger {
  return {
    async record(input: AuditEntryInput): Promise<void> {
      assertNotBlank(input.action, "action");
      assertNotBlank(input.resourceType, "resourceType");
      assertNotBlank(input.outcome, "outcome");

      await db.insert(auditLog).values({
        actorUserId: input.actorUserId ?? null,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId ?? null,
        outcome: input.outcome,
        metadata: input.metadata ?? null,
      });
    },

    async list(options?: { limit?: number }): Promise<AuditEntry[]> {
      const limit = options?.limit === undefined ? DEFAULT_LIMIT : options.limit;
      return db
        .select()
        .from(auditLog)
        .orderBy(desc(auditLog.createdAt))
        .limit(Math.min(Math.max(limit, 1), MAX_LIMIT));
    },
  };
}
