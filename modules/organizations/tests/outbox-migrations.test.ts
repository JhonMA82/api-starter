import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { migrate } from "drizzle-orm/postgres-js/migrator";
import type { Sql } from "postgres";

import { createDb } from "../../notes/src";
import {
  closeClient,
  createTestClient,
  getDatabaseUrl,
  migrateToLatest,
  resetDatabase,
} from "../../notes/tests/db-test-utils";

const databaseUrl = getDatabaseUrl();
const describeDb = databaseUrl === null ? describe.skip : describe;
if (databaseUrl === null) {
  console.warn(
    "[organizations outbox migration tests] DATABASE_URL is not set — skipping real-DB tests",
  );
}

const MIGRATIONS_DIR = new URL("../../../migrations", import.meta.url).pathname;

const PUBLIC_TABLES = [
  "account",
  "audit_log",
  "invitations",
  "memberships",
  "notes",
  "organizations",
  "outbox_events",
  "session",
  "user",
  "verification",
];

async function expectOutboxSchema(client: Sql): Promise<void> {
  type Column = { table_name: string; column_name: string };
  const columns = (await client.unsafe<Column[]>(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'outbox_events'
    ORDER BY table_name, ordinal_position
  `)) as unknown as Column[];
  expect(columns).toEqual([
    { table_name: "outbox_events", column_name: "id" },
    { table_name: "outbox_events", column_name: "event_id" },
    { table_name: "outbox_events", column_name: "type" },
    { table_name: "outbox_events", column_name: "organization_id" },
    { table_name: "outbox_events", column_name: "actor_user_id" },
    { table_name: "outbox_events", column_name: "payload" },
    { table_name: "outbox_events", column_name: "status" },
    { table_name: "outbox_events", column_name: "attempts" },
    { table_name: "outbox_events", column_name: "max_attempts" },
    { table_name: "outbox_events", column_name: "last_error" },
    { table_name: "outbox_events", column_name: "next_attempt_at" },
    { table_name: "outbox_events", column_name: "processed_at" },
    { table_name: "outbox_events", column_name: "created_at" },
    { table_name: "outbox_events", column_name: "updated_at" },
  ]);

  const indexes = await client.unsafe<{ indexname: string }[]>(`
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname IN (
        'outbox_events_status_idx',
        'outbox_events_next_attempt_at_idx'
      )
    ORDER BY indexname
  `);
  expect(indexes.map((row) => row.indexname)).toEqual([
    "outbox_events_next_attempt_at_idx",
    "outbox_events_status_idx",
  ]);

  type Constraint = { conname: string; contype: string };
  const constraints = (await client.unsafe<Constraint[]>(`
    SELECT conname, contype
    FROM pg_constraint
    WHERE conname = 'outbox_events_event_id_unique'
  `)) as unknown as Constraint[];
  expect(constraints).toEqual([{ conname: "outbox_events_event_id_unique", contype: "u" }]);
}

async function expectBookkeeping(client: Sql, count: string): Promise<void> {
  const tables = await client.unsafe<{ table_name: string }[]>(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'drizzle' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);
  expect(tables.map((row) => row.table_name)).toEqual(["__drizzle_migrations"]);

  const rows = await client.unsafe<{ count: string }[]>(
    `SELECT count(*)::text AS count FROM drizzle.__drizzle_migrations`,
  );
  expect(rows[0]?.count).toBe(count);
}

describeDb("outbox migrations (real database)", () => {
  const client = createTestClient(databaseUrl as string);

  beforeAll(async () => {
    await resetDatabase(client);
  });

  afterAll(async () => {
    await closeClient(client);
  });

  test("from zero creates 10 public tables including outbox_events and Drizzle bookkeeping", async () => {
    await resetDatabase(client);
    await migrateToLatest(client);

    const publicTables = await client.unsafe<{ table_name: string }[]>(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);
    expect(publicTables.map((row) => row.table_name)).toEqual(PUBLIC_TABLES);
    await expectOutboxSchema(client);
    await expectBookkeeping(client, "6");
  });

  test("0004-only database upgrades to include outbox_events", async () => {
    await resetDatabase(client);
    const journal = JSON.parse(
      readFileSync(join(MIGRATIONS_DIR, "meta", "_journal.json"), "utf8"),
    ) as { entries: { idx: number }[] };
    journal.entries = journal.entries.filter((entry) => entry.idx <= 4);
    const previousMigrations = readdirSync(MIGRATIONS_DIR)
      .filter((file) => /^000[0-4]_.*\.sql$/.test(file))
      .sort();
    expect(previousMigrations).toHaveLength(5);

    const tempDir = mkdtempSync(join(tmpdir(), "outbox-migrations-v4-"));
    try {
      mkdirSync(join(tempDir, "meta"));
      writeFileSync(join(tempDir, "meta", "_journal.json"), JSON.stringify(journal));
      for (const migration of previousMigrations) {
        copyFileSync(join(MIGRATIONS_DIR, migration), join(tempDir, migration));
      }

      const db = createDb(client);
      await migrate(db, { migrationsFolder: tempDir });

      const before = await client.unsafe<{ table_name: string }[]>(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
         ORDER BY table_name`,
      );
      expect(before.map((row) => row.table_name)).toEqual([
        "account",
        "audit_log",
        "invitations",
        "memberships",
        "notes",
        "organizations",
        "session",
        "user",
        "verification",
      ]);
      expect(
        await client.unsafe(`SELECT count(*)::text AS count FROM drizzle.__drizzle_migrations`),
      ).toMatchObject([{ count: "5" }]);

      await migrateToLatest(client);

      const after = await client.unsafe<{ table_name: string }[]>(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
         ORDER BY table_name`,
      );
      expect(after.map((row) => row.table_name)).toEqual(PUBLIC_TABLES);
      await expectOutboxSchema(client);
      await expectBookkeeping(client, "6");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("re-running the complete migration journal is idempotent", async () => {
    await resetDatabase(client);
    await migrateToLatest(client);
    await migrateToLatest(client);

    await expectOutboxSchema(client);
    await expectBookkeeping(client, "6");
  });
});
