import { bigint, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { organizations } from "../../../organizations/src/infrastructure/organization.schema";

export const files = pgTable(
  "files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    ownerUserId: text("owner_user_id").notNull(),
    name: text("name").notNull(),
    storageKey: text("storage_key").notNull().unique(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    sha256: text("sha256").notNull(),
    status: text("status").notNull().default("stored"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [index("files_organization_id_idx").on(table.organizationId)],
);

export const fileSchema = { files };
