import type { ApiKey } from "../domain/api-key.entity";
import type { apiKeys } from "./api-key.schema";

export type ApiKeyRow = typeof apiKeys.$inferSelect;

export function rowToApiKey(row: ApiKeyRow): ApiKey {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    prefix: row.prefix,
    keyHash: row.keyHash,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    lastUsedAt: row.lastUsedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
