import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { createDb, createNoteRepository, NoteNotFoundError } from "../src";
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

describeDb("note.repository (real database)", () => {
  const client = createTestClient(databaseUrl as string);

  beforeAll(async () => {
    await resetDatabase(client);
    await migrateToLatest(client);
  });

  afterAll(async () => {
    await closeClient(client);
  });

  test("create inserts a note with defaults", async () => {
    const repository = createNoteRepository(createDb(client));
    const title = `create-${crypto.randomUUID()}`;

    const created = await repository.create({ title, body: "A body." });

    expect(created.id).toBeString();
    expect(created.title).toBe(title);
    expect(created.body).toBe("A body.");
    expect(created.pinned).toBe(false);
    expect(created.createdAt).toBeInstanceOf(Date);
    expect(created.updatedAt).toBeInstanceOf(Date);
  });

  test("findById round-trips an inserted note", async () => {
    const repository = createNoteRepository(createDb(client));
    const title = `roundtrip-${crypto.randomUUID()}`;

    const created = await repository.create({ title, body: "Round trip.", pinned: true });
    const found = await repository.findById(created.id);

    expect(found).not.toBeNull();
    expect(found).toEqual(created);
  });

  test("findById returns null for a missing note", async () => {
    const repository = createNoteRepository(createDb(client));

    expect(await repository.findById(crypto.randomUUID())).toBeNull();
  });

  test("list returns notes ordered by createdAt then id", async () => {
    const repository = createNoteRepository(createDb(client));
    const created = await repository.create({
      title: `list-first-${crypto.randomUUID()}`,
      body: "A",
    });
    await Bun.sleep(10);
    const second = await repository.create({
      title: `list-second-${crypto.randomUUID()}`,
      body: "B",
    });

    const listed = await repository.list();

    const firstIndex = listed.findIndex((note) => note.id === created.id);
    const secondIndex = listed.findIndex((note) => note.id === second.id);
    expect(firstIndex).toBeGreaterThanOrEqual(0);
    expect(secondIndex).toBeGreaterThanOrEqual(0);
    expect(firstIndex).toBeLessThan(secondIndex);
  });

  test("update changes fields and advances updatedAt", async () => {
    const repository = createNoteRepository(createDb(client));
    const created = await repository.create({
      title: `before-${crypto.randomUUID()}`,
      body: "old",
    });
    await Bun.sleep(10);

    const updated = await repository.update(created.id, {
      title: `after-${crypto.randomUUID()}`,
      body: "new body",
      pinned: true,
    });

    expect(updated.title).toStartWith("after-");
    expect(updated.body).toBe("new body");
    expect(updated.pinned).toBe(true);
    expect(updated.updatedAt.getTime()).toBeGreaterThan(created.updatedAt.getTime());
  });

  test("delete removes the note", async () => {
    const repository = createNoteRepository(createDb(client));
    const created = await repository.create({
      title: `delete-${crypto.randomUUID()}`,
      body: "gone soon",
    });

    await repository.delete(created.id);

    expect(await repository.findById(created.id)).toBeNull();
  });

  test("update on a missing note throws NoteNotFoundError", async () => {
    const repository = createNoteRepository(createDb(client));

    await expect(repository.update(crypto.randomUUID(), { title: "nope" })).rejects.toBeInstanceOf(
      NoteNotFoundError,
    );
  });
});
