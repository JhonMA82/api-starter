import { and, desc, eq } from "drizzle-orm";

import type { CreateFileInput, FileRepository } from "../application/ports";
import type { StoredFile } from "../domain/file.entity";
import { FileNotFoundError } from "../domain/file.errors";
import type { DbOrTransaction } from "./db";
import { files } from "./file.schema";

export function createFileRepository(db: DbOrTransaction): FileRepository {
  return {
    async create(input: CreateFileInput) {
      const [row] = await db.insert(files).values(input).returning();
      if (row === undefined) {
        throw new Error("insert returned no rows");
      }
      return rowToFile(row);
    },
    async findById(input: { organizationId: string; id: string }) {
      const [row] = await db
        .select()
        .from(files)
        .where(and(eq(files.organizationId, input.organizationId), eq(files.id, input.id)));
      return row === undefined ? null : rowToFile(row);
    },
    async listByOrganization(organizationId: string, limit: number) {
      const rows = await db
        .select()
        .from(files)
        .where(and(eq(files.organizationId, organizationId), eq(files.status, "stored")))
        .orderBy(desc(files.createdAt), files.id)
        .limit(limit);
      return rows.map(rowToFile);
    },
    async markDeleted(input: { organizationId: string; id: string; deletedAt: Date }) {
      const [row] = await db
        .update(files)
        .set({ status: "deleted", deletedAt: input.deletedAt })
        .where(and(eq(files.organizationId, input.organizationId), eq(files.id, input.id)))
        .returning();
      if (row === undefined) {
        throw new FileNotFoundError(input.id);
      }
      return rowToFile(row);
    },
    async findByStorageKey(storageKey: string) {
      const [row] = await db.select().from(files).where(eq(files.storageKey, storageKey));
      return row === undefined ? null : rowToFile(row);
    },
  };
}

function rowToFile(row: typeof files.$inferSelect): StoredFile {
  return {
    id: row.id,
    organizationId: row.organizationId,
    ownerUserId: row.ownerUserId,
    name: row.name,
    storageKey: row.storageKey,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    sha256: row.sha256,
    status: row.status as StoredFile["status"],
    createdAt: row.createdAt,
    deletedAt: row.deletedAt,
  };
}
