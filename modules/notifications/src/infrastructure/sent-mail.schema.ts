import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const sentMails = pgTable("sent_mails", {
  id: uuid("id").primaryKey().defaultRandom(),
  dedupeKey: text("dedupe_key").notNull().unique(),
  messageId: text("message_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const notificationSchema = { sentMails };
