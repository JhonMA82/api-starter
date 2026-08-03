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

import { createDb } from "../../../modules/notes/src";
import {
  closeClient,
  createTestClient,
  getDatabaseUrl,
  migrateToLatest,
  resetDatabase,
} from "../../../modules/notes/tests/db-test-utils";

const databaseUrl = getDatabaseUrl();
const describeDb = databaseUrl === null ? describe.skip : describe;
if (databaseUrl === null) {
  console.warn("[audit migration tests] DATABASE_URL is not set — skipping real-DB tests");
}

const MIGRATIONS_DIR = new URL("../../../migrations", import.meta.url).pathname;

async function expectAuditSchema(client: Sql): Promise<void> {
  type Column = { table_name: string; column_name: string };
  const columns = (await client.unsafe<Column[]>(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'audit_log'
    ORDER BY table_name, ordinal_position
  `)) as unknown as Column[];
  expect(columns).toEqual([
    { table_name: "audit_log", column_name: "id" },
    { table_name: "audit_log", column_name: "actor_user_id" },
    { table_name: "audit_log", column_name: "action" },
    { table_name: "audit_log", column_name: "resource_type" },
    { table_name: "audit_log", column_name: "resource_id" },
    { table_name: "audit_log", column_name: "outcome" },
    { table_name: "audit_log", column_name: "metadata" },
    { table_name: "audit_log", column_name: "created_at" },
  ]);

  const indexes = await client.unsafe<{ indexname: string }[]>(`
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname IN ('audit_log_created_at_idx', 'audit_log_resource_type_idx')
    ORDER BY indexname
  `);
  expect(indexes.map((row) => row.indexname)).toEqual([
    "audit_log_created_at_idx",
    "audit_log_resource_type_idx",
  ]);

  const triggers = await client.unsafe<{ tgname: string }[]>(`
    SELECT tgname
    FROM pg_trigger
    WHERE tgname = 'audit_log_append_only'
  `);
  expect(triggers.map((row) => row.tgname)).toEqual(["audit_log_append_only"]);

  const functions = await client.unsafe<{ proname: string }[]>(`
    SELECT proname
    FROM pg_proc
    WHERE proname = 'reject_audit_log_mutation'
  `);
  expect(functions.map((row) => row.proname)).toEqual(["reject_audit_log_mutation"]);
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

describeDb("audit migrations (real database)", () => {
  const client = createTestClient(databaseUrl as string);

  beforeAll(async () => {
    await resetDatabase(client);
  });

  afterAll(async () => {
    await closeClient(client);
  });

  test("from zero creates 11 public tables and Drizzle bookkeeping", async () => {
    await resetDatabase(client);
    await migrateToLatest(client);

    const publicTables = await client.unsafe<{ table_name: string }[]>(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);
    expect(publicTables.map((row) => row.table_name)).toEqual([
      "account",
      "audit_log",
      "invitations",
      "jobs",
      "memberships",
      "notes",
      "organizations",
      "outbox_events",
      "session",
      "user",
      "verification",
    ]);
    await expectAuditSchema(client);
    await expectBookkeeping(client, "7");
  });

  test("0002-only database upgrades to the full schema", async () => {
    await resetDatabase(client);
    const journal = JSON.parse(
      readFileSync(join(MIGRATIONS_DIR, "meta", "_journal.json"), "utf8"),
    ) as { entries: { idx: number }[] };
    journal.entries = journal.entries.filter((entry) => entry.idx <= 2);
    const previousMigrations = readdirSync(MIGRATIONS_DIR)
      .filter((file) => /^000[012]_.*\.sql$/.test(file))
      .sort();
    expect(previousMigrations).toHaveLength(3);

    const tempDir = mkdtempSync(join(tmpdir(), "audit-migrations-v2-"));
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
        "notes",
        "session",
        "user",
        "verification",
      ]);

      await migrateToLatest(client);

      await expectAuditSchema(client);
      await expectBookkeeping(client, "7");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("re-running the complete migration journal is idempotent", async () => {
    await resetDatabase(client);
    await migrateToLatest(client);
    await migrateToLatest(client);

    await expectAuditSchema(client);
    await expectBookkeeping(client, "7");
  });
});
