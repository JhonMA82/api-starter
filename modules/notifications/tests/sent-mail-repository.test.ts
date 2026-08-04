import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  closeClient,
  createTestClient,
  getDatabaseUrl,
  migrateToLatest,
  resetDatabase,
} from "../../notes/tests/db-test-utils";
import { createDb, createSentMailRepository } from "../src";

const databaseUrl = getDatabaseUrl();
const describeDb = databaseUrl === null ? describe.skip : describe;
if (databaseUrl === null) {
  console.warn("[sent mail repository tests] DATABASE_URL is not set — skipping real-DB tests");
}

describeDb("sent mail repository (real database)", () => {
  const client = createTestClient(databaseUrl as string);

  beforeAll(async () => {
    await resetDatabase(client);
    await migrateToLatest(client);
  });

  afterAll(async () => {
    await closeClient(client);
  });

  test("record then isDuplicated lifecycle", async () => {
    const repository = createSentMailRepository(createDb(client));

    expect(await repository.isDuplicated("invitation:tok-1:user@example.com")).toBe(false);

    await repository.record("invitation:tok-1:user@example.com", "message-1");

    expect(await repository.isDuplicated("invitation:tok-1:user@example.com")).toBe(true);
    expect(await repository.isDuplicated("invitation:tok-2:user@example.com")).toBe(false);
  });

  test("recording the same dedupe key twice is idempotent (onConflictDoNothing)", async () => {
    const repository = createSentMailRepository(createDb(client));
    const key = `invitation:${crypto.randomUUID()}:user@example.com`;

    await repository.record(key, "message-first");
    await repository.record(key, "message-second");

    const rows = await client.unsafe<{ dedupe_key: string; message_id: string }[]>(
      `SELECT dedupe_key, message_id FROM sent_mails WHERE dedupe_key = '${key}'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.message_id).toBe("message-first");
  });

  test("the unique constraint on dedupe_key rejects raw duplicates", async () => {
    const key = `invitation:${crypto.randomUUID()}:user@example.com`;
    await client.unsafe(
      `INSERT INTO sent_mails (dedupe_key, message_id) VALUES ('${key}', 'message-a')`,
    );

    const duplicateError = await client
      .unsafe(`INSERT INTO sent_mails (dedupe_key, message_id) VALUES ('${key}', 'message-b')`)
      .then(
        () => null,
        (err: unknown) => err,
      );
    expect(String(duplicateError)).toMatch(/unique constraint/);
  });
});
