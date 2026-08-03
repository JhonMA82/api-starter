import type { Note } from "../domain/note.entity";
import { assertValidTitle } from "../domain/note.entity";
import type { UnitOfWork, UpdateNoteInput } from "./ports";

export async function updateNote(
  uow: UnitOfWork,
  id: string,
  input: UpdateNoteInput,
): Promise<Note> {
  if (input.title !== undefined) {
    assertValidTitle(input.title);
  }
  return uow.run((tx) => tx.notes.update(id, input));
}
