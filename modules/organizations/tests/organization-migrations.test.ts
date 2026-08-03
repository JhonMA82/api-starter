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
  console.warn("[organizations migration tests] DATABASE_URL is not set — skipping real-DB tests");
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

async function expectOrganizationSchema(client: Sql): Promise<void> {
  type Column = { table_name: string; column_name: string };
  const columns = (await client.unsafe<Column[]>(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN ('organizations', 'memberships', 'invitations')
    ORDER BY table_name, ordinal_position
  `)) as unknown as Column[];
  expect(columns).toEqual([
    { table_name: "invitations", column_name: "id" },
    { table_name: "invitations", column_name: "organization_id" },
    { table_name: "invitations", column_name: "email" },
    { table_name: "invitations", column_name: "role" },
    { table_name: "invitations", column_name: "token_hash" },
    { table_name: "invitations", column_name: "expires_at" },
    { table_name: "invitations", column_name: "used_at" },
    { table_name: "invitations", column_name: "created_at" },
    { table_name: "memberships", column_name: "id" },
    { table_name: "memberships", column_name: "organization_id" },
    { table_name: "memberships", column_name: "user_id" },
    { table_name: "memberships", column_name: "role" },
    { table_name: "memberships", column_name: "status" },
    { table_name: "memberships", column_name: "created_at" },
    { table_name: "memberships", column_name: "updated_at" },
    { table_name: "organizations", column_name: "id" },
    { table_name: "organizations", column_name: "name" },
    { table_name: "organizations", column_name: "slug" },
    { table_name: "organizations", column_name: "status" },
    { table_name: "organizations", column_name: "created_at" },
    { table_name: "organizations", column_name: "updated_at" },
  ]);

  const indexes = await client.unsafe<{ indexname: string }[]>(`
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname IN (
        'invitations_organization_id_idx',
        'invitations_email_idx',
        'memberships_organization_id_idx',
        'memberships_user_id_idx'
      )
    ORDER BY indexname
  `);
  expect(indexes.map((row) => row.indexname)).toEqual([
    "invitations_email_idx",
    "invitations_organization_id_idx",
    "memberships_organization_id_idx",
    "memberships_user_id_idx",
  ]);

  type Constraint = { conname: string; contype: string };
  const constraints = (await client.unsafe<Constraint[]>(`
    SELECT conname, contype
    FROM pg_constraint
    WHERE conname IN (
      'organizations_name_not_blank',
      'organizations_slug_unique',
      'memberships_organization_user_unique',
      'invitations_token_hash_unique'
    )
    ORDER BY conname
  `)) as unknown as Constraint[];
  expect(constraints).toEqual([
    { conname: "invitations_token_hash_unique", contype: "u" },
    { conname: "memberships_organization_user_unique", contype: "u" },
    { conname: "organizations_name_not_blank", contype: "c" },
    { conname: "organizations_slug_unique", contype: "u" },
  ]);

  type ForeignKey = { conname: string; confdeltype: string };
  const foreignKeys = (await client.unsafe<ForeignKey[]>(`
    SELECT conname, confdeltype
    FROM pg_constraint
    WHERE contype = 'f'
      AND conrelid IN (
        'public.organizations'::regclass,
        'public.memberships'::regclass,
        'public.invitations'::regclass
      )
    ORDER BY conname
  `)) as unknown as ForeignKey[];
  expect(foreignKeys).toEqual([
    { conname: "invitations_organization_id_organizations_id_fk", confdeltype: "c" },
    { conname: "memberships_organization_id_organizations_id_fk", confdeltype: "c" },
    { conname: "memberships_user_id_user_id_fk", confdeltype: "c" },
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

describeDb("organizations migrations (real database)", () => {
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
    expect(publicTables.map((row) => row.table_name)).toEqual(PUBLIC_TABLES);
    await expectOrganizationSchema(client);
    await expectBookkeeping(client, "6");
  });

  test("0003-only database upgrades to the full organizational schema", async () => {
    await resetDatabase(client);
    const journal = JSON.parse(
      readFileSync(join(MIGRATIONS_DIR, "meta", "_journal.json"), "utf8"),
    ) as { entries: { idx: number }[] };
    journal.entries = journal.entries.filter((entry) => entry.idx <= 3);
    const previousMigrations = readdirSync(MIGRATIONS_DIR)
      .filter((file) => /^000[0-3]_.*\.sql$/.test(file))
      .sort();
    expect(previousMigrations).toHaveLength(4);

    const tempDir = mkdtempSync(join(tmpdir(), "organizations-migrations-v3-"));
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
        "notes",
        "session",
        "user",
        "verification",
      ]);

      await migrateToLatest(client);

      await expectOrganizationSchema(client);
      await expectBookkeeping(client, "6");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("re-running the complete migration journal is idempotent", async () => {
    await resetDatabase(client);
    await migrateToLatest(client);
    await migrateToLatest(client);

    await expectOrganizationSchema(client);
    await expectBookkeeping(client, "6");
  });

  test("memberships FK to auth user and cascade on organization delete", async () => {
    await resetDatabase(client);
    await migrateToLatest(client);

    await client.unsafe(`
      INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
      VALUES ('org-test-user', 'Org Test User', 'org-test-user@example.com', true, now(), now())
    `);

    const org = (await client.unsafe<{ id: string }[]>(`
      INSERT INTO organizations (name, slug)
      VALUES ('Acme Inc', 'acme-inc')
      RETURNING id
    `)) as unknown as { id: string }[];
    const organizationId = org[0]?.id;
    expect(organizationId).toBeDefined();

    await client.unsafe(
      `INSERT INTO memberships (organization_id, user_id, role)
       VALUES ('${organizationId}', 'org-test-user', 'owner')`,
    );

    const memberships = (await client.unsafe<{ count: string }[]>(
      `SELECT count(*)::text AS count FROM memberships`,
    )) as unknown as { count: string }[];
    expect(memberships[0]?.count).toBe("1");

    await client.unsafe(`DELETE FROM organizations WHERE id = '${organizationId}'`);

    const afterDelete = (await client.unsafe<{ count: string }[]>(
      `SELECT count(*)::text AS count FROM memberships`,
    )) as unknown as { count: string }[];
    expect(afterDelete[0]?.count).toBe("0");
  });
});
