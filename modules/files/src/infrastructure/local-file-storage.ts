import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import type { FileStorage } from "../application/ports";
import { FileNotFoundError } from "../domain/file.errors";

/**
 * Filesystem-backed FileStorage for development: files live under
 * rootDir/<storageKey>. Not for production — the S3-compatible adapter
 * (MinIO/AWS S3/R2) is a drop-in replacement (spec §15).
 */
export function createLocalFileStorage(rootDir: string): FileStorage {
  return {
    async put(input) {
      const filePath = resolveStoragePath(rootDir, input.storageKey);
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, input.data);
    },
    async get(storageKey) {
      const filePath = resolveStoragePath(rootDir, storageKey);
      try {
        return await readFile(filePath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          throw new FileNotFoundError(storageKey);
        }
        throw error;
      }
    },
    async delete(storageKey) {
      const filePath = resolveStoragePath(rootDir, storageKey);
      await rm(filePath, { force: true });
    },
  };
}

function resolveStoragePath(rootDir: string, storageKey: string): string {
  assertSafeStorageKey(storageKey);
  return resolve(join(rootDir, storageKey));
}

function assertSafeStorageKey(storageKey: string): void {
  if (storageKey.includes("..") || storageKey.startsWith("/") || storageKey.includes("\0")) {
    throw new Error(`invalid storage key: ${storageKey}`);
  }
}
