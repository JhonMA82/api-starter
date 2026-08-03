import { describe, expect, test, vi } from "bun:test";

import type { NoteRepository, UnitOfWork, UpdateNoteInput } from "../src/application/ports";
import { updateNote } from "../src/application/update-note";
import type { Note } from "../src/domain/note.entity";
import { InvalidNoteError, NoteNotFoundError } from "../src/domain/note.errors";

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
