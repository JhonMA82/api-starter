import { eq } from "drizzle-orm";

import type { CreateNoteInput, NoteRepository, UpdateNoteInput } from "../application/ports";
import type { Note } from "../domain/note.entity";
import { NoteNotFoundError } from "../domain/note.errors";
import type { DbOrTransaction } from "./db";
import { createToRow, rowToEntity } from "./note.mapper";
import { notes } from "./note.schema";

export function createNoteRepository(db: DbOrTransaction): NoteRepository {
  return {
    async create(input: CreateNoteInput): Promise<Note> {
      const [row] = await db.insert(notes).values(createToRow(input)).returning();
      if (row === undefined) {
        throw new Error("insert returned no rows");
      }
      return rowToEntity(row);
    },
    async findById(id: string): Promise<Note | null> {
      const [row] = await db.select().from(notes).where(eq(notes.id, id));
      return row === undefined ? null : rowToEntity(row);
    },
    async list(): Promise<Note[]> {
      const rows = await db.select().from(notes).orderBy(notes.createdAt, notes.id);
      return rows.map(rowToEntity);
    },
    async update(id: string, input: UpdateNoteInput): Promise<Note> {
      const [row] = await db
        .update(notes)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(notes.id, id))
        .returning();
      if (row === undefined) {
        throw new NoteNotFoundError(id);
      }
      return rowToEntity(row);
    },
    async delete(id: string): Promise<void> {
      await db.delete(notes).where(eq(notes.id, id));
    },
  };
}
