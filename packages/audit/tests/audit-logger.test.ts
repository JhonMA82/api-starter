import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Sql } from "postgres";

import {
  closeClient,
  createTestClient,
  getDatabaseUrl,
  migrateToLatest,
  resetDatabase,
} from "../../../modules/notes/tests/db-test-utils";
import { createAuditDb, createAuditLogger } from "../src";

const databaseUrl = getDatabaseUrl();
const describeDb = databaseUrl === null ? describe.skip : describe;
if (databaseUrl === null) {
  console.warn("[audit tests] DATABASE_URL is not set — skipping real-DB tests");
}

async function clearAuditLog(client: Sql): Promise<void> {
  await client.unsafe("ALTER TABLE audit_log DISABLE TRIGGER audit_log_append_only");
  await client.unsafe("TRUNCATE audit_log");
  await client.unsafe("ALTER TABLE audit_log ENABLE TRIGGER audit_log_append_only");
}

describeDb("audit logger (real database)", () => {
  const client = createTestClient(databaseUrl as string);

  beforeAll(async () => {
    await resetDatabase(client);
    await migrateToLatest(client);
  });

  afterAll(async () => {
    await closeClient(client);
  });

  test("record inserts and list returns newest-first with full fields", async () => {
    await clearAuditLog(client);

    const logger = createAuditLogger(createAuditDb(client));
    await logger.record({
      actorUserId: "user-1",
      action: "notes.create",
      resourceType: "note",
      resourceId: "note-42",
      outcome: "allowed",
      metadata: { ip: "127.0.0.1", extra: { flag: true } },
    });
    await logger.record({
      actorUserId: "user-1",
      action: "notes.delete",
      resourceType: "note",
      resourceId: "note-41",
      outcome: "denied",
    });

    const entries = await logger.list();
    expect(entries).toHaveLength(2);
    expect(entries[0]?.action).toBe("notes.delete");
    expect(entries[1]?.action).toBe("notes.create");

    const first = entries[0];
    expect(first?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(first?.actorUserId).toBe("user-1");
    expect(first?.resourceType).toBe("note");
    expect(first?.resourceId).toBe("note-41");
    expect(first?.outcome).toBe("denied");
    expect(first?.metadata).toBeNull();
    expect(first?.createdAt).toBeInstanceOf(Date);

    const second = entries[1];
    expect(second?.metadata).toEqual({ ip: "127.0.0.1", extra: { flag: true } });
    expect(second?.createdAt).toBeInstanceOf(Date);
  });

  test("list limit returns only the requested number of rows, newest first", async () => {
    await clearAuditLog(client);

    const logger = createAuditLogger(createAuditDb(client));
    for (let i = 1; i <= 3; i += 1) {
      await logger.record({
        action: `action-${i}`,
        resourceType: "note",
        outcome: "success",
      });
    }

    const entries = await logger.list({ limit: 2 });
    expect(entries).toHaveLength(2);
    expect(entries[0]?.action).toBe("action-3");
    expect(entries[1]?.action).toBe("action-2");
  });

  test("blank action/resourceType/outcome throw RangeError", async () => {
    const logger = createAuditLogger(createAuditDb(client));

    await expect(
      logger.record({ action: "", resourceType: "note", outcome: "success" }),
    ).rejects.toThrow(RangeError);
    await expect(
      logger.record({ action: "  ", resourceType: "note", outcome: "success" }),
    ).rejects.toThrow(RangeError);
    await expect(
      logger.record({ action: "notes.create", resourceType: "", outcome: "success" }),
    ).rejects.toThrow(RangeError);
    await expect(
      logger.record({ action: "notes.create", resourceType: "note", outcome: "" }),
    ).rejects.toThrow(RangeError);
  });

  test("append-only is enforced by the DB trigger (UPDATE and DELETE throw)", async () => {
    await clearAuditLog(client);

    const logger = createAuditLogger(createAuditDb(client));
    await logger.record({
      action: "notes.update",
      resourceType: "note",
      resourceId: "note-7",
      outcome: "success",
    });

    const entries = await logger.list();
    const id = entries[0]?.id as string;

    const updateError = await client
      .unsafe(`UPDATE audit_log SET outcome = 'tampered' WHERE id = '${id}'`)
      .then(
        () => null,
        (err: unknown) => err,
      );
    expect(String(updateError)).toMatch(/append-only/i);

    const deleteError = await client.unsafe(`DELETE FROM audit_log WHERE id = '${id}'`).then(
      () => null,
      (err: unknown) => err,
    );
    expect(String(deleteError)).toMatch(/append-only/i);

    const after = await logger.list();
    expect(after).toHaveLength(1);
    expect(after[0]?.outcome).toBe("success");
  });

  test("system action without actor stores NULL actor_user_id", async () => {
    await clearAuditLog(client);

    const logger = createAuditLogger(createAuditDb(client));
    await logger.record({
      action: "system.maintenance",
      resourceType: "system",
      outcome: "success",
    });

    const entries = await logger.list();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.action).toBe("system.maintenance");
    expect(entries[0]?.actorUserId).toBeNull();
    expect(entries[0]?.resourceId).toBeNull();
    expect(entries[0]?.metadata).toBeNull();
  });
});
