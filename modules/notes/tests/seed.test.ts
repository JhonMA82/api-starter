import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { createDb, seedNotes } from "../src";
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

describeDb("seedNotes (real database)", () => {
  const client = createTestClient(databaseUrl as string);

  beforeAll(async () => {
    await resetDatabase(client);
    await migrateToLatest(client);
  });

  afterAll(async () => {
    await closeClient(client);
  });

  test("inserts the fixed seeds once and is a no-op on re-run", async () => {
    const db = createDb(client);

    const firstRun = await seedNotes(db);
    expect(firstRun).toBe(3);

    const secondRun = await seedNotes(db);
    expect(secondRun).toBe(0);

    const count = await client.unsafe<{ count: string }[]>(
      "SELECT count(*)::text AS count FROM notes",
    );
    expect(count[0]?.count).toBe("3");

    const pinned = await client.unsafe<{ count: string }[]>(
      "SELECT count(*)::text AS count FROM notes WHERE pinned = true",
    );
    expect(pinned[0]?.count).toBe("1");
  });
});
