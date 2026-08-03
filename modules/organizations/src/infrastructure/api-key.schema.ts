import { index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

import { organizations } from "./organization.schema";

export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    prefix: text("prefix").notNull(),
    keyHash: text("key_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("api_keys_organization_id_idx").on(table.organizationId),
    unique("api_keys_key_hash_unique").on(table.keyHash),
  ],
);

export const apiKeySchema = { apiKeys };
