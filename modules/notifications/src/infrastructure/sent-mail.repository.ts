import { eq } from "drizzle-orm";

import type { SentMailRepository } from "../application/ports";
import type { DbOrTransaction } from "./db";
import { sentMails } from "./sent-mail.schema";

/**
 * DB-backed dedupe ledger for sent notifications. The unique constraint on
 * dedupe_key makes record() idempotent under concurrency via
 * onConflictDoNothing.
 */
export function createSentMailRepository(db: DbOrTransaction): SentMailRepository {
  return {
    async isDuplicated(dedupeKey) {
      const [row] = await db
        .select({ id: sentMails.id })
        .from(sentMails)
        .where(eq(sentMails.dedupeKey, dedupeKey));
      return row !== undefined;
    },
    async record(dedupeKey, messageId) {
      await db.insert(sentMails).values({ dedupeKey, messageId }).onConflictDoNothing();
    },
  };
}
