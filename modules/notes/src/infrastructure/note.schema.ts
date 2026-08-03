import { sql } from "drizzle-orm";
import { boolean, check, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const notes = pgTable(
  "notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    pinned: boolean("pinned").notNull().default(false),
  },
  (table) => [check("notes_title_not_blank", sql`length(btrim(${table.title})) > 0`)],
);
