import type { CreateFileInput, FileRepository, MembershipGuard } from "../src/application/ports";
import type { StoredFile } from "../src/domain/file.entity";

export function makeStoredFile(overrides: Partial<StoredFile> = {}): StoredFile {
  return {
    id: "file-1",
    organizationId: "org-1",
    ownerUserId: "user-1",
    name: "report.pdf",
    storageKey: "org-1/file-1/report.pdf",
    mimeType: "application/pdf",
    sizeBytes: 1024,
    sha256: "0".repeat(64),
    status: "stored",
    createdAt: new Date("2026-08-03T12:00:00.000Z"),
    deletedAt: null,
    ...overrides,
  };
}

/**
 * Tenant-scoped in-memory FileRepository, mirroring the real repository's
 * semantics (findById scoped by organization, list filters deleted).
 */
export function createFakeFileRepository(
  seed: StoredFile[] = [],
): FileRepository & { rows(): Map<string, StoredFile> } {
  const store = new Map<string, StoredFile>();
  const key = (organizationId: string, id: string) => `${organizationId}:${id}`;
  for (const file of seed) {
    store.set(key(file.organizationId, file.id), file);
  }
  return {
    async create(input: CreateFileInput) {
      const file: StoredFile = {
        ...input,
        id: `file-${store.size + 1}`,
        status: "stored",
        createdAt: new Date("2026-08-03T12:00:00.000Z"),
        deletedAt: null,
      };
      store.set(key(file.organizationId, file.id), file);
      return file;
    },
    async findById(input) {
      return store.get(key(input.organizationId, input.id)) ?? null;
    },
    async listByOrganization(organizationId, limit) {
      return [...store.values()]
        .filter((file) => file.organizationId === organizationId && file.status === "stored")
        .slice(0, limit);
    },
    async markDeleted(input) {
      const file = store.get(key(input.organizationId, input.id));
      if (file === undefined) {
        throw new Error("fake repo: file not found");
      }
      const updated: StoredFile = { ...file, status: "deleted", deletedAt: input.deletedAt };
      store.set(key(input.organizationId, input.id), updated);
      return updated;
    },
    async findByStorageKey(storageKey) {
      for (const file of store.values()) {
        if (file.storageKey === storageKey) {
          return file;
        }
      }
      return null;
    },
    rows() {
      return store;
    },
  };
}

export class FakeForbiddenError extends Error {
  constructor() {
    super("fake guard: forbidden");
    this.name = "FakeForbiddenError";
  }
}

export function createAllowAllMembershipGuard(): MembershipGuard {
  return {
    async assertCanManage() {
      /* allow everything */
    },
  };
}

export function createDenyingMembershipGuard(): MembershipGuard {
  return {
    async assertCanManage() {
      throw new FakeForbiddenError();
    },
  };
}
