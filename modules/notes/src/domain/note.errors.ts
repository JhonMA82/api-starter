export class NoteNotFoundError extends Error {
  constructor(id: string) {
    super(`Note not found: ${id}`);
    this.name = "NoteNotFoundError";
  }
}

export class InvalidNoteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidNoteError";
  }
}
