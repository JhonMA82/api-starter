import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Sql } from "postgres";

import {
  closeClient,
  createTestClient,
  getDatabaseUrl,
  migrateToLatest,
  resetDatabase,
} from "../../notes/tests/db-test-utils";
import {
  createDb,
  createDeleteFileUseCase,
  createDownloadFileUseCase,
  createFileRepository,
  createLocalFileStorage,
  createSha256Hasher,
  createUploadFileUseCase,
  FileNotFoundError,
} from "../src";
import { createAllowAllMembershipGuard } from "./fakes";

const databaseUrl = getDatabaseUrl();
const describeDb = databaseUrl === null ? describe.skip : describe;
if (databaseUrl === null) {
  console.warn("[file repository tests] DATABASE_URL is not set — skipping real-DB tests");
}

async function insertOrganization(client: Sql, name: string, slug: string): Promise<string> {
  const rows = (await client.unsafe<{ id: string }[]>(`
    INSERT INTO organizations (name, slug) VALUES ('${name}', '${slug}')
    RETURNING id
  `)) as unknown as { id: string }[];
  const id = rows[0]?.id;
  if (id === undefined) {
    throw new Error("organization insert returned no rows");
  }
  return id;
}

describe("local file storage (real filesystem)", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "files-local-storage-"));
  const storage = createLocalFileStorage(tempDir);

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("put creates nested directories and get returns the same bytes", async () => {
    const data = Buffer.from("pdf-bytes");
    await storage.put({
      storageKey: "org-1/abc-123/report.pdf",
      data,
      mimeType: "application/pdf",
    });
    expect(readFileSync(join(tempDir, "org-1", "abc-123", "report.pdf")).equals(data)).toBe(true);
    expect((await storage.get("org-1/abc-123/report.pdf")).equals(data)).toBe(true);
  });

  test("put overwrites existing content", async () => {
    const key = "org-1/abc-123/overwrite.txt";
    await storage.put({ storageKey: key, data: Buffer.from("first"), mimeType: "text/plain" });
    await storage.put({ storageKey: key, data: Buffer.from("second"), mimeType: "text/plain" });
    expect((await storage.get(key)).toString()).toBe("second");
  });

  test("get of a missing key raises FileNotFoundError", async () => {
    await expect(storage.get("org-1/missing/file.txt")).rejects.toBeInstanceOf(FileNotFoundError);
  });

  test("delete removes the file and does not throw for a missing key", async () => {
    const key = "org-1/abc-123/to-delete.txt";
    await storage.put({ storageKey: key, data: Buffer.from("gone"), mimeType: "text/plain" });
    await storage.delete(key);
    await expect(storage.get(key)).rejects.toBeInstanceOf(FileNotFoundError);
    await expect(storage.delete("org-1/never-existed.txt")).resolves.toBeUndefined();
  });

  test("rejects storage keys that could escape the root directory", async () => {
    await expect(
      storage.put({ storageKey: "../evil.txt", data: Buffer.from("x"), mimeType: "text/plain" }),
    ).rejects.toThrow("invalid storage key");
    await expect(storage.get("/absolute.txt")).rejects.toThrow("invalid storage key");
    await expect(storage.delete("org-1/\u0000nul.txt")).rejects.toThrow("invalid storage key");
  });
});

describeDb("file repositories (real database)", () => {
  const client = createTestClient(databaseUrl as string);

  beforeAll(async () => {
    await resetDatabase(client);
    await migrateToLatest(client);
  });

  afterAll(async () => {
    await closeClient(client);
  });

  test("create, tenant-scoped findById, listByOrganization, markDeleted, findByStorageKey lifecycle", async () => {
    const db = createDb(client);
    const repository = createFileRepository(db);
    const orgA = await insertOrganization(client, "Files Org A", `files-a-${crypto.randomUUID()}`);
    const orgB = await insertOrganization(client, "Files Org B", `files-b-${crypto.randomUUID()}`);

    const created = await repository.create({
      organizationId: orgA,
      ownerUserId: "user-1",
      name: "report.pdf",
      storageKey: `${orgA}/key-1/report.pdf`,
      mimeType: "application/pdf",
      sizeBytes: 10,
      sha256: "a".repeat(64),
    });
    expect(created.id).toBeString();
    expect(created.organizationId).toBe(orgA);
    expect(created.ownerUserId).toBe("user-1");
    expect(created.name).toBe("report.pdf");
    expect(created.mimeType).toBe("application/pdf");
    expect(created.sizeBytes).toBe(10);
    expect(created.sha256).toBe("a".repeat(64));
    expect(created.status).toBe("stored");
    expect(created.deletedAt).toBeNull();
    expect(created.createdAt).toBeInstanceOf(Date);

    expect(await repository.findById({ organizationId: orgA, id: created.id })).toEqual(created);

    const crossTenant = await repository.findById({ organizationId: orgB, id: created.id });
    expect(crossTenant).toBeNull();

    expect(await repository.findById({ organizationId: orgA, id: crypto.randomUUID() })).toBeNull();

    expect((await repository.listByOrganization(orgA, 10)).map((file) => file.id)).toEqual([
      created.id,
    ]);
    expect(await repository.listByOrganization(orgB, 10)).toEqual([]);

    const deletedAt = new Date("2026-08-03T13:00:00.000Z");
    const deleted = await repository.markDeleted({
      organizationId: orgA,
      id: created.id,
      deletedAt,
    });
    expect(deleted.status).toBe("deleted");
    expect(deleted.deletedAt).toEqual(deletedAt);

    expect((await repository.findById({ organizationId: orgA, id: created.id }))?.status).toBe(
      "deleted",
    );
    expect(await repository.listByOrganization(orgA, 10)).toEqual([]);

    expect(await repository.findByStorageKey(`${orgA}/key-1/report.pdf`)).toEqual(deleted);
    expect(await repository.findByStorageKey("missing/key")).toBeNull();

    await expect(
      repository.markDeleted({ organizationId: orgA, id: crypto.randomUUID(), deletedAt }),
    ).rejects.toBeInstanceOf(FileNotFoundError);
  });

  test("listByOrganization respects the limit and excludes deleted files", async () => {
    const db = createDb(client);
    const repository = createFileRepository(db);
    const org = await insertOrganization(client, "Files Org C", `files-c-${crypto.randomUUID()}`);
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const file = await repository.create({
        organizationId: org,
        ownerUserId: "user-1",
        name: `file-${i}.pdf`,
        storageKey: `${org}/key-${i}/file-${i}.pdf`,
        mimeType: "application/pdf",
        sizeBytes: 1,
        sha256: `${i}`.repeat(64),
      });
      ids.push(file.id);
    }
    await repository.markDeleted({
      organizationId: org,
      id: ids[1] as string,
      deletedAt: new Date(),
    });

    const limited = await repository.listByOrganization(org, 2);
    expect(limited.length).toBe(2);

    const all = await repository.listByOrganization(org, 10);
    expect(all.map((file) => file.id).sort()).toEqual([ids[0] as string, ids[2] as string].sort());
  });
});

describeDb("upload/download end-to-end with local storage (real database)", () => {
  const client = createTestClient(databaseUrl as string);
  const tempDir = mkdtempSync(join(tmpdir(), "files-e2e-"));

  beforeAll(async () => {
    await resetDatabase(client);
    await migrateToLatest(client);
  });

  afterAll(async () => {
    await closeClient(client);
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("uploads to disk and downloads the same bytes; deleted files are no longer downloadable", async () => {
    const org = await insertOrganization(client, "Files Org D", `files-d-${crypto.randomUUID()}`);
    const db = createDb(client);
    const repository = createFileRepository(db);
    const storage = createLocalFileStorage(tempDir);
    const guard = createAllowAllMembershipGuard();
    const upload = createUploadFileUseCase({
      files: repository,
      storage,
      hash: createSha256Hasher(),
      guard,
    });
    const download = createDownloadFileUseCase({ files: repository, storage, guard });

    const data = Buffer.from("end-to-end content");
    const uploaded = await upload({
      actorUserId: "user-1",
      organizationId: org,
      name: "notes.txt",
      mimeType: "text/plain",
      data,
    });
    expect(uploaded.sha256).toBe(createSha256Hasher().hash(data));
    expect(uploaded.storageKey).toMatch(new RegExp(`^${org}/[0-9a-f-]{36}/notes\\.txt$`));

    const downloaded = await download({
      actorUserId: "user-1",
      organizationId: org,
      fileId: uploaded.id,
    });
    expect(downloaded.file).toEqual(uploaded);
    expect(downloaded.data.equals(data)).toBe(true);

    await expect(
      download({ actorUserId: "user-1", organizationId: org, fileId: crypto.randomUUID() }),
    ).rejects.toBeInstanceOf(FileNotFoundError);

    const remove = createDeleteFileUseCase({ files: repository, guard });
    await remove({ actorUserId: "user-1", organizationId: org, fileId: uploaded.id });

    await expect(
      download({ actorUserId: "user-1", organizationId: org, fileId: uploaded.id }),
    ).rejects.toBeInstanceOf(FileNotFoundError);
  });
});
