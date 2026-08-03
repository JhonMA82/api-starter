import type { CreateNoteInput } from "../application/ports";
import type { Note } from "../domain/note.entity";
import type { notes } from "./note.schema";

export type NoteRow = typeof notes.$inferSelect;

export function rowToEntity(row: NoteRow): Note {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    pinned: row.pinned ?? false,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createToRow(input: CreateNoteInput): typeof notes.$inferInsert {
  return { title: input.title, body: input.body, pinned: input.pinned ?? false };
}
