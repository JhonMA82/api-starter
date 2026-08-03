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
  console.warn("[auth migration tests] DATABASE_URL is not set — skipping real-DB tests");
}

const MIGRATIONS_DIR = new URL("../../../migrations", import.meta.url).pathname;

async function expectAuthSchema(client: Sql): Promise<void> {
  type Column = { table_name: string; column_name: string };
  const columns = (await client.unsafe<Column[]>(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN ('user', 'session', 'account', 'verification')
    ORDER BY table_name, ordinal_position
  `)) as unknown as Column[];
  expect(columns).toEqual([
    { table_name: "account", column_name: "id" },
    { table_name: "account", column_name: "account_id" },
    { table_name: "account", column_name: "provider_id" },
    { table_name: "account", column_name: "user_id" },
    { table_name: "account", column_name: "access_token" },
    { table_name: "account", column_name: "refresh_token" },
    { table_name: "account", column_name: "id_token" },
    { table_name: "account", column_name: "access_token_expires_at" },
    { table_name: "account", column_name: "refresh_token_expires_at" },
    { table_name: "account", column_name: "scope" },
    { table_name: "account", column_name: "password" },
    { table_name: "account", column_name: "created_at" },
    { table_name: "account", column_name: "updated_at" },
    { table_name: "session", column_name: "id" },
    { table_name: "session", column_name: "expires_at" },
    { table_name: "session", column_name: "token" },
    { table_name: "session", column_name: "created_at" },
    { table_name: "session", column_name: "updated_at" },
    { table_name: "session", column_name: "ip_address" },
    { table_name: "session", column_name: "user_agent" },
    { table_name: "session", column_name: "user_id" },
    { table_name: "user", column_name: "id" },
    { table_name: "user", column_name: "name" },
    { table_name: "user", column_name: "email" },
    { table_name: "user", column_name: "email_verified" },
    { table_name: "user", column_name: "image" },
    { table_name: "user", column_name: "created_at" },
    { table_name: "user", column_name: "updated_at" },
    { table_name: "verification", column_name: "id" },
    { table_name: "verification", column_name: "identifier" },
    { table_name: "verification", column_name: "value" },
    { table_name: "verification", column_name: "expires_at" },
    { table_name: "verification", column_name: "created_at" },
    { table_name: "verification", column_name: "updated_at" },
  ]);

  const indexes = await client.unsafe<{ indexname: string }[]>(`
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname IN ('account_userId_idx', 'session_userId_idx', 'verification_identifier_idx')
    ORDER BY indexname
  `);
  expect(indexes.map((row) => row.indexname)).toEqual([
    "account_userId_idx",
    "session_userId_idx",
    "verification_identifier_idx",
  ]);

  const uniqueConstraints = await client.unsafe<{ conname: string }[]>(`
    SELECT conname
    FROM pg_constraint
    WHERE conname IN ('session_token_unique', 'user_email_unique')
    ORDER BY conname
  `);
  expect(uniqueConstraints.map((row) => row.conname)).toEqual([
    "session_token_unique",
    "user_email_unique",
  ]);

  type ForeignKey = { conname: string; confdeltype: string };
  const foreignKeys = (await client.unsafe<ForeignKey[]>(`
    SELECT conname, confdeltype
    FROM pg_constraint
    WHERE contype = 'f'
      AND conrelid IN ('public.account'::regclass, 'public.session'::regclass)
    ORDER BY conname
  `)) as unknown as ForeignKey[];
  expect(foreignKeys).toEqual([
    { conname: "account_user_id_user_id_fk", confdeltype: "c" },
    { conname: "session_user_id_user_id_fk", confdeltype: "c" },
  ]);
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

describeDb("auth migrations (real database)", () => {
  const client = createTestClient(databaseUrl as string);

  beforeAll(async () => {
    await resetDatabase(client);
  });

  afterAll(async () => {
    await closeClient(client);
  });

  test("from zero creates 10 public tables and Drizzle bookkeeping", async () => {
    await resetDatabase(client);
    await migrateToLatest(client);

    const publicTables = await client.unsafe<{ table_name: string }[]>(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);
    // 10 public tables plus drizzle.__drizzle_migrations bookkeeping.
    expect(publicTables.map((row) => row.table_name)).toEqual([
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
    ]);
    await expectAuthSchema(client);
    await expectBookkeeping(client, "6");
  });

  test("0001 to 0002 preserves notes rows and adds the auth schema", async () => {
    await resetDatabase(client);
    const journal = JSON.parse(
      readFileSync(join(MIGRATIONS_DIR, "meta", "_journal.json"), "utf8"),
    ) as { entries: { idx: number }[] };
    journal.entries = journal.entries.filter((entry) => entry.idx <= 1);
    const previousMigrations = readdirSync(MIGRATIONS_DIR)
      .filter((file) => /^000[01]_.*\.sql$/.test(file))
      .sort();
    expect(previousMigrations).toHaveLength(2);

    const tempDir = mkdtempSync(join(tmpdir(), "auth-migrations-v1-"));
    try {
      mkdirSync(join(tempDir, "meta"));
      writeFileSync(join(tempDir, "meta", "_journal.json"), JSON.stringify(journal));
      for (const migration of previousMigrations) {
        copyFileSync(join(MIGRATIONS_DIR, migration), join(tempDir, migration));
      }

      const db = createDb(client);
      await migrate(db, { migrationsFolder: tempDir });
      await client.unsafe(
        `INSERT INTO notes (title, body) VALUES ('upgrade-a', 'first'), ('upgrade-b', 'second'), ('upgrade-c', 'third')`,
      );

      await migrateToLatest(client);

      const rows = (await client.unsafe<{ title: string; pinned: boolean }[]>(
        `SELECT title, pinned FROM notes ORDER BY title`,
      )) as unknown as { title: string; pinned: boolean }[];
      expect(rows).toEqual([
        { title: "upgrade-a", pinned: false },
        { title: "upgrade-b", pinned: false },
        { title: "upgrade-c", pinned: false },
      ]);
      await expectAuthSchema(client);
      await expectBookkeeping(client, "6");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("re-running the complete migration journal is idempotent", async () => {
    await resetDatabase(client);
    await migrateToLatest(client);
    await migrateToLatest(client);

    await expectAuthSchema(client);
    await expectBookkeeping(client, "6");
  });
});
