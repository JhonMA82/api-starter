import type { StoredFile } from "../domain/file.entity";

/**
 * S3-compatible storage abstraction (spec §15). The interface is shaped so a
 * MinIO/AWS S3/R2 adapter is a drop-in later; the local-filesystem adapter is
 * used for dev and tests.
 */
export interface FileStorage {
  put(input: { storageKey: string; data: Buffer; mimeType: string }): Promise<void>;
  /** Throws FileNotFoundError when the key does not exist. */
  get(storageKey: string): Promise<Buffer>;
  delete(storageKey: string): Promise<void>;
}

export interface CreateFileInput {
  organizationId: string;
  ownerUserId: string;
  name: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
}

export interface FileRepository {
  create(input: CreateFileInput): Promise<StoredFile>;
  /** Tenant-scoped: only resolves files that belong to the given organization. */
  findById(input: { organizationId: string; id: string }): Promise<StoredFile | null>;
  listByOrganization(organizationId: string, limit: number): Promise<StoredFile[]>;
  markDeleted(input: { organizationId: string; id: string; deletedAt: Date }): Promise<StoredFile>;
  findByStorageKey(storageKey: string): Promise<StoredFile | null>;
}

/** sha256 hex hashing (wrapper over node:crypto, injectable for tests). */
export interface FileHashing {
  hash(data: Buffer): string;
}

/**
 * Decoupled membership check. The application wires this port to the
 * organizations module tenancy/membership logic (modules/files must not
 * import organizations internals). Throws when the actor is not an active
 * member allowed to manage resources of the organization.
 */
export interface MembershipGuard {
  assertCanManage(actorUserId: string, organizationId: string): Promise<void>;
}
