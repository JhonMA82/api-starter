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

import { createDb } from "../src";
import {
  closeClient,
  createTestClient,
  getDatabaseUrl,
  migrateToLatest,
  resetDatabase,
} from "./db-test-utils";

const databaseUrl = getDatabaseUrl();
const describeDb = databaseUrl === null ? describe.skip : describe;
if (databaseUrl === null) {
  console.warn("[notes tests] DATABASE_URL is not set — skipping real-DB tests");
}

const MIGRATIONS_DIR = new URL("../../../migrations", import.meta.url).pathname;

describeDb("migrations (real database)", () => {
  const client = createTestClient(databaseUrl as string);

  beforeAll(async () => {
    await resetDatabase(client);
  });

  afterAll(async () => {
    await closeClient(client);
  });

  test("from zero: migrateToLatest creates the full v2 schema", async () => {
    await resetDatabase(client);
    await migrateToLatest(client);

    const columns = await client.unsafe<{ column_name: string }[]>(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'notes'
      ORDER BY ordinal_position
    `);
    expect(columns.map((row) => row.column_name)).toEqual([
      "id",
      "title",
      "body",
      "created_at",
      "updated_at",
      "pinned",
    ]);

    const constraints = await client.unsafe<{ conname: string }[]>(`
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'public.notes'::regclass
    `);
    expect(constraints.some((row) => row.conname === "notes_title_not_blank")).toBe(true);

    const bookkeeping = await client.unsafe<{ count: string }[]>(
      `SELECT count(*)::text AS count FROM drizzle.__drizzle_migrations`,
    );
    expect(bookkeeping[0]?.count).toBe("9");
  });

  test("upgrade: v1-only database keeps rows when v2 migration applies", async () => {
    await resetDatabase(client);
    const journal = JSON.parse(
      readFileSync(join(MIGRATIONS_DIR, "meta", "_journal.json"), "utf8"),
    ) as { entries: { idx: number }[] };
    journal.entries = journal.entries.filter((entry) => entry.idx === 0);
    const migration0000 = readdirSync(MIGRATIONS_DIR).find((file) => /^0000_.*\.sql$/.test(file));
    expect(migration0000).toBeDefined();

    const tempDir = mkdtempSync(join(tmpdir(), "migrations-v1-"));
    try {
      mkdirSync(join(tempDir, "meta"));
      writeFileSync(join(tempDir, "meta", "_journal.json"), JSON.stringify(journal));
      copyFileSync(
        join(MIGRATIONS_DIR, migration0000 as string),
        join(tempDir, migration0000 as string),
      );

      const db = createDb(client);
      await migrate(db, { migrationsFolder: tempDir });

      await client.unsafe(
        `INSERT INTO notes (title, body) VALUES ('upgrade-a', 'first'), ('upgrade-b', 'second'), ('upgrade-c', 'third')`,
      );

      await migrate(db, { migrationsFolder: MIGRATIONS_DIR });

      const rows = (await client.unsafe(`SELECT title, pinned FROM notes ORDER BY title`)) as {
        title: string;
        pinned: boolean;
      }[];
      expect(rows).toEqual([
        { title: "upgrade-a", pinned: false },
        { title: "upgrade-b", pinned: false },
        { title: "upgrade-c", pinned: false },
      ]);

      const bookkeeping = await client.unsafe<{ count: string }[]>(
        `SELECT count(*)::text AS count FROM drizzle.__drizzle_migrations`,
      );
      expect(bookkeeping[0]?.count).toBe("9");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("idempotent: re-running migrateToLatest is a no-op", async () => {
    await resetDatabase(client);
    await migrateToLatest(client);
    await migrateToLatest(client);

    const bookkeeping = await client.unsafe<{ count: string }[]>(
      `SELECT count(*)::text AS count FROM drizzle.__drizzle_migrations`,
    );
    expect(bookkeeping[0]?.count).toBe("9");
  });
});
