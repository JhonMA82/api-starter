import { InvalidNoteError } from "./note.errors";

export interface Note {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export function assertValidTitle(title: string): void {
  if (title.trim() === "") {
    throw new InvalidNoteError("title must not be blank");
  }
}
