import { and, eq } from "drizzle-orm";

import type { ApiKeyRepository, CreateApiKeyInput } from "../application/ports";
import { ApiKeyNotFoundError } from "../domain/organization.errors";
import { rowToApiKey } from "./api-key.mapper";
import { apiKeys } from "./api-key.schema";
import type { DbOrTransaction } from "./db";

export function createApiKeyRepository(db: DbOrTransaction): ApiKeyRepository {
  return {
    async create(input: CreateApiKeyInput) {
      const [row] = await db.insert(apiKeys).values(input).returning();
      if (row === undefined) {
        throw new Error("insert returned no rows");
      }
      return rowToApiKey(row);
    },
    async findByKeyHash(keyHash: string) {
      const [row] = await db.select().from(apiKeys).where(eq(apiKeys.keyHash, keyHash));
      return row === undefined ? null : rowToApiKey(row);
    },
    async findById(input: { organizationId: string; id: string }) {
      const [row] = await db
        .select()
        .from(apiKeys)
        .where(and(eq(apiKeys.organizationId, input.organizationId), eq(apiKeys.id, input.id)));
      return row === undefined ? null : rowToApiKey(row);
    },
    async listByOrganization(organizationId: string) {
      const rows = await db
        .select()
        .from(apiKeys)
        .where(eq(apiKeys.organizationId, organizationId))
        .orderBy(apiKeys.createdAt, apiKeys.id);
      return rows.map(rowToApiKey);
    },
    async revoke(input: { organizationId: string; id: string; revokedAt: Date }) {
      const [row] = await db
        .update(apiKeys)
        .set({ revokedAt: input.revokedAt, updatedAt: new Date() })
        .where(and(eq(apiKeys.organizationId, input.organizationId), eq(apiKeys.id, input.id)))
        .returning();
      if (row === undefined) {
        throw new ApiKeyNotFoundError(input.organizationId, input.id);
      }
      return rowToApiKey(row);
    },
    async markUsed(id: string, usedAt: Date) {
      await db
        .update(apiKeys)
        .set({ lastUsedAt: usedAt, updatedAt: new Date() })
        .where(eq(apiKeys.id, id));
    },
  };
}
