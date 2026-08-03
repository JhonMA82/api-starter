import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  closeClient,
  createTestClient,
  getDatabaseUrl,
  migrateToLatest,
  resetDatabase,
} from "../../notes/tests/db-test-utils";
import { createDb, createIncomingWebhookRepository } from "../src";

const databaseUrl = getDatabaseUrl();
const describeDb = databaseUrl === null ? describe.skip : describe;
if (databaseUrl === null) {
  console.warn(
    "[incoming webhook repository tests] DATABASE_URL is not set — skipping real-DB tests",
  );
}

describeDb("incoming webhook repositories (real database)", () => {
  const client = createTestClient(databaseUrl as string);

  beforeAll(async () => {
    await resetDatabase(client);
    await migrateToLatest(client);
  });

  afterAll(async () => {
    await closeClient(client);
  });

  test("createIfAbsent inserts and returns created=true with the stored row", async () => {
    const db = createDb(client);
    const repository = createIncomingWebhookRepository(db);

    const { created, webhook } = await repository.createIfAbsent({
      provider: "stripe",
      eventId: "evt_1",
      payload: { id: "evt_1", data: { amount: 100 } },
      signatureValid: true,
    });

    expect(created).toBe(true);
    expect(webhook.id).toBeString();
    expect(webhook).toMatchObject({
      provider: "stripe",
      eventId: "evt_1",
      payload: { id: "evt_1", data: { amount: 100 } },
      signatureValid: true,
      status: "received",
      processedAt: null,
    });
    expect(webhook.receivedAt).toBeInstanceOf(Date);
    expect(webhook.createdAt).toBeInstanceOf(Date);
  });

  test("createIfAbsent is idempotent: the second insert returns created=false and the same row", async () => {
    const db = createDb(client);
    const repository = createIncomingWebhookRepository(db);

    const first = await repository.createIfAbsent({
      provider: "stripe",
      eventId: "evt_dup",
      payload: { id: "evt_dup" },
      signatureValid: true,
    });
    const second = await repository.createIfAbsent({
      provider: "stripe",
      eventId: "evt_dup",
      payload: { id: "evt_dup", mutated: true },
      signatureValid: true,
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.webhook.id).toBe(first.webhook.id);
    expect(second.webhook.payload).toEqual({ id: "evt_dup" });

    const rows = await client.unsafe<{ count: string }[]>(
      `SELECT count(*)::text AS count FROM incoming_webhooks
       WHERE provider = 'stripe' AND event_id = 'evt_dup'`,
    );
    expect(rows[0]?.count).toBe("1");
  });

  test("the same event id from a different provider is a distinct row", async () => {
    const db = createDb(client);
    const repository = createIncomingWebhookRepository(db);

    const stripe = await repository.createIfAbsent({
      provider: "stripe",
      eventId: "evt_shared",
      payload: {},
      signatureValid: true,
    });
    const github = await repository.createIfAbsent({
      provider: "github",
      eventId: "evt_shared",
      payload: {},
      signatureValid: true,
    });

    expect(stripe.created).toBe(true);
    expect(github.created).toBe(true);
    expect(github.webhook.id).not.toBe(stripe.webhook.id);
  });

  test("findByProviderAndEventId and findById round-trip", async () => {
    const db = createDb(client);
    const repository = createIncomingWebhookRepository(db);

    const { webhook } = await repository.createIfAbsent({
      provider: "n8n",
      eventId: "evt_find",
      payload: { raw: "unparseable body" },
      signatureValid: true,
    });

    expect(await repository.findByProviderAndEventId("n8n", "evt_find")).toEqual(webhook);
    expect(await repository.findByProviderAndEventId("n8n", "missing")).toBeNull();
    expect(await repository.findById(webhook.id)).toEqual(webhook);
    expect(await repository.findById(crypto.randomUUID())).toBeNull();
  });

  test("lifecycle: markProcessing -> markProcessed records the processed timestamp", async () => {
    const db = createDb(client);
    const repository = createIncomingWebhookRepository(db);

    const { webhook } = await repository.createIfAbsent({
      provider: "stripe",
      eventId: "evt_lifecycle",
      payload: {},
      signatureValid: true,
    });

    await repository.markProcessing(webhook.id);
    const processing = await repository.findById(webhook.id);
    expect(processing?.status).toBe("processing");
    expect(processing?.processedAt).toBeNull();

    await repository.markProcessed(webhook.id);
    const processed = await repository.findById(webhook.id);
    expect(processed?.status).toBe("processed");
    expect(processed?.processedAt).toBeInstanceOf(Date);

    await repository.markFailed(webhook.id);
    const failed = await repository.findById(webhook.id);
    expect(failed?.status).toBe("failed");
    expect(failed?.processedAt).toBeInstanceOf(Date);
  });

  test("a concurrent duplicate insert never creates two rows (unique constraint)", async () => {
    const db = createDb(client);
    const repository = createIncomingWebhookRepository(db);

    const results = await Promise.all([
      repository.createIfAbsent({
        provider: "stripe",
        eventId: "evt_race",
        payload: { from: "a" },
        signatureValid: true,
      }),
      repository.createIfAbsent({
        provider: "stripe",
        eventId: "evt_race",
        payload: { from: "b" },
        signatureValid: true,
      }),
    ]);

    expect(results.filter((result) => result.created)).toHaveLength(1);
    const rows = await client.unsafe<{ count: string }[]>(
      `SELECT count(*)::text AS count FROM incoming_webhooks
       WHERE provider = 'stripe' AND event_id = 'evt_race'`,
    );
    expect(rows[0]?.count).toBe("1");
  });

  test("incoming_webhooks has no foreign keys (providers are external actors)", async () => {
    const foreignKeys = (await client.unsafe<{ conname: string }[]>(`
      SELECT conname
      FROM pg_constraint
      WHERE contype = 'f' AND conrelid = 'public.incoming_webhooks'::regclass
    `)) as unknown as { conname: string }[];
    expect(foreignKeys).toEqual([]);
  });
});
