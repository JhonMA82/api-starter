import type { UnitOfWork } from "../application/ports";
import type { DbOrTransaction, DbTransaction } from "./db";
import { createNoteRepository } from "./note.repository";

export function createUnitOfWork(db: DbOrTransaction): UnitOfWork {
  return {
    run<T>(work: (uow: UnitOfWork) => Promise<T>): Promise<T> {
      return db.transaction((tx: DbTransaction) => work(createUnitOfWork(tx)));
    },
    notes: createNoteRepository(db),
  };
}
