import type { FileStorage } from "../application/ports";
import { FileNotFoundError } from "../domain/file.errors";

/**
 * In-memory FileStorage — for tests only. Not for production use.
 */
export function createInMemoryFileStorage(): FileStorage & {
  entries(): Map<string, Buffer>;
} {
  const store = new Map<string, Buffer>();
  return {
    async put(input) {
      store.set(input.storageKey, Buffer.from(input.data));
    },
    async get(storageKey) {
      const data = store.get(storageKey);
      if (data === undefined) {
        throw new FileNotFoundError(storageKey);
      }
      return Buffer.from(data);
    },
    async delete(storageKey) {
      store.delete(storageKey);
    },
    entries() {
      return store;
    },
  };
}
