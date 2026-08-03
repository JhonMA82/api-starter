import { boolean, index, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

import type { IncomingWebhookStatus } from "../domain/incoming-webhook.entity";

export const incomingWebhooks = pgTable(
  "incoming_webhooks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull(),
    eventId: text("event_id").notNull(),
    // The redacted parsed payload (or { raw } for unparseable bodies).
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    signatureValid: boolean("signature_valid").notNull(),
    status: text("status").$type<IncomingWebhookStatus>().notNull().default("received"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Idempotency at the DB level: a replayed event (same provider + event id)
    // is never inserted twice.
    unique("incoming_webhooks_provider_event_unique").on(table.provider, table.eventId),
    index("incoming_webhooks_provider_idx").on(table.provider),
    index("incoming_webhooks_status_idx").on(table.status),
  ],
);

export const incomingWebhookSchema = { incomingWebhooks };
