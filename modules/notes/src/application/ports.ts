import type { Note } from "../domain/note.entity";

export interface CreateNoteInput {
  title: string;
  body: string;
  pinned?: boolean;
}

export interface UpdateNoteInput {
  title?: string;
  body?: string;
  pinned?: boolean;
}

export interface NoteRepository {
  create(input: CreateNoteInput): Promise<Note>;
  findById(id: string): Promise<Note | null>;
  list(): Promise<Note[]>;
  update(id: string, input: UpdateNoteInput): Promise<Note>;
  delete(id: string): Promise<void>;
}

export interface UnitOfWork {
  run<T>(work: (uow: UnitOfWork) => Promise<T>): Promise<T>;
  readonly notes: NoteRepository;
}
