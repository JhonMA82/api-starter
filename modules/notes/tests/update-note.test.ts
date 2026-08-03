import { afterAll, beforeAll, describe, expect, test, vi } from "bun:test";

import { createClient, createDb, createUnitOfWork, updateNote } from "../src";
import type { NoteRepository, UnitOfWork, UpdateNoteInput } from "../src/application/ports";
import type { Note } from "../src/domain/note.entity";
import { InvalidNoteError, NoteNotFoundError } from "../src/domain/note.errors";
import {
  closeClient,
  createTestClient,
  getDatabaseUrl,
  migrateToLatest,
  resetDatabase,
} from "./db-test-utils";

function makeNote(overrides: Partial<Note> = {}): Note {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    title: "Welcome",
    body: "A note body.",
    pinned: false,
    createdAt: new Date("2026-08-02T00:00:00.000Z"),
    updatedAt: new Date("2026-08-02T00:00:00.000Z"),
    ...overrides,
  };
}

function createFakeUnitOfWork(repository: NoteRepository): UnitOfWork {
  const uow: UnitOfWork = {
    run: <T>(work: (inner: UnitOfWork) => Promise<T>): Promise<T> => work(uow),
    notes: repository,
  };
  return uow;
}

describe("updateNote", () => {
  test("rejects a blank title before any transaction work", async () => {
    const update = vi.fn();
    const repository = { update } as unknown as NoteRepository;
    const uow = createFakeUnitOfWork(repository);
    const runSpy = vi.spyOn(uow, "run");

    await expect(updateNote(uow, "missing-id", { title: "   " })).rejects.toBeInstanceOf(
      InvalidNoteError,
    );
    expect(runSpy).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  test("propagates NoteNotFoundError when the note does not exist", async () => {
    const repository: NoteRepository = {
      create: vi.fn(),
      findById: vi.fn(),
      list: vi.fn(),
      update: vi.fn(async () => {
        throw new NoteNotFoundError("missing-id");
      }),
      delete: vi.fn(),
    };
    const uow = createFakeUnitOfWork(repository);

    await expect(updateNote(uow, "missing-id", { title: "Renamed" })).rejects.toBeInstanceOf(
      NoteNotFoundError,
    );
  });

  test("delegates the update to the repository inside the transaction", async () => {
    const existing = makeNote();
    const repository: NoteRepository = {
      create: vi.fn(),
      findById: vi.fn(),
      list: vi.fn(),
      update: vi.fn(async (id: string, input: UpdateNoteInput) => ({ ...existing, ...input, id })),
      delete: vi.fn(),
    };
    const uow = createFakeUnitOfWork(repository);

    const result = await updateNote(uow, existing.id, { title: "Renamed" });

    expect(repository.update).toHaveBeenCalledWith(existing.id, { title: "Renamed" });
    expect(result).toEqual({ ...existing, title: "Renamed" });
  });
});

const databaseUrl = getDatabaseUrl();
const describeDb = databaseUrl === null ? describe.skip : describe;
if (databaseUrl === null) {
  console.warn("[notes tests] DATABASE_URL is not set — skipping real-DB tests");
}

describeDb("updateNote (real database)", () => {
  const client = createTestClient(databaseUrl as string);

  beforeAll(async () => {
    await resetDatabase(client);
    await migrateToLatest(client);
  });

  afterAll(async () => {
    await closeClient(client);
  });

  test("updates title, body, and pinned inside one transaction", async () => {
    const db = createDb(client);
    const repository = createUnitOfWork(db).notes;
    const created = await repository.create({
      title: `before-${crypto.randomUUID()}`,
      body: "old body",
    });
    await Bun.sleep(10);

    const uow = createUnitOfWork(db);
    const updated = await updateNote(uow, created.id, {
      title: `after-${crypto.randomUUID()}`,
      body: "new body",
      pinned: true,
    });

    expect(updated.title).toStartWith("after-");
    expect(updated.body).toBe("new body");
    expect(updated.pinned).toBe(true);
    expect(updated.updatedAt.getTime()).toBeGreaterThan(created.updatedAt.getTime());

    const reloaded = await repository.findById(created.id);
    expect(reloaded).toEqual(updated);
  });

  test("rolls the transaction back when a statement violates a constraint", async () => {
    const db = createDb(client);
    const uow = createUnitOfWork(db);
    const created = await uow.notes.create({
      title: `keep-me-${crypto.randomUUID()}`,
      body: "must survive",
    });
    await Bun.sleep(10);

    await expect(
      uow.run(async (tx) => {
        await tx.notes.update(created.id, { title: "changed" });
        await tx.notes.create({ title: "   ", body: "violates CHECK" });
      }),
    ).rejects.toBeDefined();

    const reloaded = await createUnitOfWork(db).notes.findById(created.id);
    expect(reloaded?.title).toBe(created.title);
    expect(reloaded?.updatedAt.getTime()).toBe(created.updatedAt.getTime());
  });

  test("throws NoteNotFoundError when the note does not exist", async () => {
    const db = createDb(client);
    const uow = createUnitOfWork(db);

    await expect(updateNote(uow, crypto.randomUUID(), { title: "Renamed" })).rejects.toBeInstanceOf(
      NoteNotFoundError,
    );
  });
});
