import { describe, expect, test } from "bun:test";

import {
  ALLOWED_MIME_TYPES,
  assertAllowedMimeType,
  assertFileSize,
  createDeleteFileUseCase,
  createDownloadFileUseCase,
  createInMemoryFileStorage,
  createListFilesUseCase,
  createSha256Hasher,
  createUploadFileUseCase,
  FileNotFoundError,
  FileStorageUnavailableError,
  FileTooLargeError,
  generateStorageKey,
  InvalidFileNameError,
  MAX_FILE_SIZE_BYTES,
  sanitizeFileName,
  UnsupportedMimeTypeError,
} from "../src";
import type { FileStorage, MembershipGuard } from "../src/application/ports";
import {
  createAllowAllMembershipGuard,
  createDenyingMembershipGuard,
  createFakeFileRepository,
  FakeForbiddenError,
  makeStoredFile,
} from "./fakes";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("sanitizeFileName", () => {
  test("strips path separators (posix and windows)", () => {
    expect(sanitizeFileName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFileName("..\\..\\windows\\evil.exe")).toBe("evil.exe");
    expect(sanitizeFileName("/absolute/path/report.pdf")).toBe("report.pdf");
    expect(sanitizeFileName("C:\\Users\\juan\\file.txt")).toBe("file.txt");
  });

  test("strips control characters", () => {
    expect(sanitizeFileName("report\u0000.pdf")).toBe("report.pdf");
    expect(sanitizeFileName("a\u0001b\u0007c")).toBe("abc");
    expect(sanitizeFileName("file\u001b[31m")).toBe("file[31m");
  });

  test("caps the length at 200 characters", () => {
    expect(sanitizeFileName("a".repeat(300))).toBe("a".repeat(200));
    expect(sanitizeFileName("b".repeat(150))).toBe("b".repeat(150));
  });

  test("falls back to 'file' when nothing remains", () => {
    expect(sanitizeFileName("")).toBe("file");
    expect(sanitizeFileName("   ")).toBe("file");
    expect(sanitizeFileName("///")).toBe("file");
    expect(sanitizeFileName("\u0000")).toBe("file");
  });

  test("rejects non-string input", () => {
    expect(() => sanitizeFileName(undefined as unknown as string)).toThrow(InvalidFileNameError);
  });
});

describe("generateStorageKey", () => {
  test("produces <orgId>/<uuid>/<sanitized-name>", () => {
    const key = generateStorageKey({ organizationId: "org-1", fileName: "report.pdf" });
    const [organizationId, uuid, name] = key.split("/");
    expect(organizationId).toBe("org-1");
    expect(uuid).toMatch(UUID_PATTERN);
    expect(name).toBe("report.pdf");
  });

  test("embeds the sanitized name", () => {
    expect(generateStorageKey({ organizationId: "org-1", fileName: "../evil.txt" })).toMatch(
      /\/evil\.txt$/,
    );
    expect(generateStorageKey({ organizationId: "org-1", fileName: "" })).toMatch(/\/file$/);
  });

  test("generates unique keys for identical names", () => {
    const a = generateStorageKey({ organizationId: "org-1", fileName: "same.pdf" });
    const b = generateStorageKey({ organizationId: "org-1", fileName: "same.pdf" });
    expect(a).not.toBe(b);
  });
});

describe("mime type and size asserts", () => {
  test("accepts every allowed mime type", () => {
    for (const mimeType of ALLOWED_MIME_TYPES) {
      expect(() => assertAllowedMimeType(mimeType)).not.toThrow();
    }
  });

  test("rejects a disallowed mime type", () => {
    expect(() => assertAllowedMimeType("application/x-msdownload")).toThrow(
      UnsupportedMimeTypeError,
    );
  });

  test("accepts sizes up to the limit and rejects anything larger", () => {
    expect(() => assertFileSize(0)).not.toThrow();
    expect(() => assertFileSize(MAX_FILE_SIZE_BYTES)).not.toThrow();
    expect(() => assertFileSize(MAX_FILE_SIZE_BYTES + 1)).toThrow(FileTooLargeError);
  });
});

type TestStorage = FileStorage & { entries(): Map<string, Buffer> };

describe("upload use case", () => {
  function setup(overrides: { storage?: TestStorage; guard?: MembershipGuard } = {}): {
    storage: TestStorage;
    files: ReturnType<typeof createFakeFileRepository>;
    upload: ReturnType<typeof createUploadFileUseCase>;
  } {
    const storage = overrides.storage ?? createInMemoryFileStorage();
    const files = createFakeFileRepository();
    const guard = overrides.guard ?? createAllowAllMembershipGuard();
    const upload = createUploadFileUseCase({ files, storage, hash: createSha256Hasher(), guard });
    return { storage, files, upload };
  }

  test("stores the blob and the metadata row", async () => {
    const { storage, files, upload } = setup();
    const data = Buffer.from("hello files");

    const created = await upload({
      actorUserId: "user-1",
      organizationId: "org-1",
      name: "report.pdf",
      mimeType: "application/pdf",
      data,
    });

    expect(created.id).toBeString();
    expect(created.organizationId).toBe("org-1");
    expect(created.ownerUserId).toBe("user-1");
    expect(created.name).toBe("report.pdf");
    expect(created.sizeBytes).toBe(data.length);
    expect(created.status).toBe("stored");
    expect(created.deletedAt).toBeNull();
    expect(created.createdAt).toBeInstanceOf(Date);
    expect(created.sha256).toBe(createSha256Hasher().hash(data));
    expect(created.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(created.storageKey).toMatch(/^org-1\/[0-9a-f-]{36}\/report\.pdf$/);

    expect(storage.entries().size).toBe(1);
    expect(storage.entries().get(created.storageKey)?.toString()).toBe("hello files");
    expect(files.rows().size).toBe(1);
    expect(files.rows().get("org-1:".concat(created.id))).toEqual(created);
  });

  test("stores the sanitized file name and key", async () => {
    const { storage, upload } = setup();
    const created = await upload({
      actorUserId: "user-1",
      organizationId: "org-1",
      name: "../../evil.sh",
      mimeType: "text/plain",
      data: Buffer.from("#!/bin/sh"),
    });
    expect(created.name).toBe("evil.sh");
    expect(created.storageKey).toMatch(/\/evil\.sh$/);
    expect(storage.entries().size).toBe(1);
  });

  test("rejects a disallowed mime type without storing anything", async () => {
    const { storage, upload } = setup();
    await expect(
      upload({
        actorUserId: "user-1",
        organizationId: "org-1",
        name: "virus.exe",
        mimeType: "application/x-msdownload",
        data: Buffer.from("MZ"),
      }),
    ).rejects.toBeInstanceOf(UnsupportedMimeTypeError);
    expect(storage.entries().size).toBe(0);
  });

  test("rejects an oversized file without storing anything", async () => {
    const { storage, upload } = setup();
    await expect(
      upload({
        actorUserId: "user-1",
        organizationId: "org-1",
        name: "huge.bin",
        mimeType: "application/pdf",
        data: Buffer.alloc(MAX_FILE_SIZE_BYTES + 1),
      }),
    ).rejects.toBeInstanceOf(FileTooLargeError);
    expect(storage.entries().size).toBe(0);
  });

  test("wraps storage failures in FileStorageUnavailableError and stores no row", async () => {
    const failingStorage: TestStorage = {
      async put() {
        throw new Error("connection refused");
      },
      async get() {
        throw new Error("unreachable");
      },
      async delete() {},
      entries() {
        return new Map();
      },
    };
    const { files, upload } = setup({ storage: failingStorage });
    await expect(
      upload({
        actorUserId: "user-1",
        organizationId: "org-1",
        name: "report.pdf",
        mimeType: "application/pdf",
        data: Buffer.from("data"),
      }),
    ).rejects.toBeInstanceOf(FileStorageUnavailableError);
    expect(files.rows().size).toBe(0);
  });

  test("propagates membership guard denials without storing anything", async () => {
    const { storage, upload } = setup({ guard: createDenyingMembershipGuard() });
    await expect(
      upload({
        actorUserId: "user-1",
        organizationId: "org-1",
        name: "report.pdf",
        mimeType: "application/pdf",
        data: Buffer.from("data"),
      }),
    ).rejects.toBeInstanceOf(FakeForbiddenError);
    expect(storage.entries().size).toBe(0);
  });
});

describe("download use case", () => {
  test("returns the metadata row and the blob", async () => {
    const storage = createInMemoryFileStorage();
    const seeded = makeStoredFile();
    const files = createFakeFileRepository([seeded]);
    await storage.put({
      storageKey: seeded.storageKey,
      data: Buffer.from("pdf-bytes"),
      mimeType: seeded.mimeType,
    });
    const download = createDownloadFileUseCase({
      files,
      storage,
      guard: createAllowAllMembershipGuard(),
    });

    const result = await download({
      actorUserId: "user-1",
      organizationId: seeded.organizationId,
      fileId: seeded.id,
    });
    expect(result.file).toEqual(seeded);
    expect(result.data.toString()).toBe("pdf-bytes");
  });

  test("unknown file id raises FileNotFoundError", async () => {
    const storage = createInMemoryFileStorage();
    const files = createFakeFileRepository();
    const download = createDownloadFileUseCase({
      files,
      storage,
      guard: createAllowAllMembershipGuard(),
    });
    await expect(
      download({ actorUserId: "user-1", organizationId: "org-1", fileId: "missing" }),
    ).rejects.toBeInstanceOf(FileNotFoundError);
  });

  test("a file of another tenant is invisible (tenant-scoped lookup)", async () => {
    const storage = createInMemoryFileStorage();
    const seeded = makeStoredFile({ id: "file-2", organizationId: "org-2" });
    const files = createFakeFileRepository([seeded]);
    const download = createDownloadFileUseCase({
      files,
      storage,
      guard: createAllowAllMembershipGuard(),
    });
    await expect(
      download({ actorUserId: "user-1", organizationId: "org-1", fileId: seeded.id }),
    ).rejects.toBeInstanceOf(FileNotFoundError);
  });

  test("a deleted file raises FileNotFoundError", async () => {
    const storage = createInMemoryFileStorage();
    const seeded = makeStoredFile();
    const files = createFakeFileRepository([seeded]);
    await storage.put({
      storageKey: seeded.storageKey,
      data: Buffer.from("pdf-bytes"),
      mimeType: seeded.mimeType,
    });
    await files.markDeleted({
      organizationId: seeded.organizationId,
      id: seeded.id,
      deletedAt: new Date("2026-08-03T13:00:00.000Z"),
    });
    const download = createDownloadFileUseCase({
      files,
      storage,
      guard: createAllowAllMembershipGuard(),
    });
    await expect(
      download({ actorUserId: "user-1", organizationId: seeded.organizationId, fileId: seeded.id }),
    ).rejects.toBeInstanceOf(FileNotFoundError);
  });
});

describe("delete use case", () => {
  test("soft-deletes the row and leaves the blob untouched", async () => {
    const storage = createInMemoryFileStorage();
    const seeded = makeStoredFile();
    const files = createFakeFileRepository([seeded]);
    await storage.put({
      storageKey: seeded.storageKey,
      data: Buffer.from("pdf-bytes"),
      mimeType: seeded.mimeType,
    });
    const remove = createDeleteFileUseCase({ files, guard: createAllowAllMembershipGuard() });

    const deleted = await remove({
      actorUserId: "user-1",
      organizationId: seeded.organizationId,
      fileId: seeded.id,
    });
    expect(deleted.status).toBe("deleted");
    expect(deleted.deletedAt).toBeInstanceOf(Date);
    expect(storage.entries().size).toBe(1);
    expect(storage.entries().get(seeded.storageKey)?.toString()).toBe("pdf-bytes");
  });

  test("unknown file id raises FileNotFoundError", async () => {
    const files = createFakeFileRepository();
    const remove = createDeleteFileUseCase({ files, guard: createAllowAllMembershipGuard() });
    await expect(
      remove({ actorUserId: "user-1", organizationId: "org-1", fileId: "missing" }),
    ).rejects.toBeInstanceOf(FileNotFoundError);
  });

  test("propagates membership guard denials", async () => {
    const files = createFakeFileRepository([makeStoredFile()]);
    const remove = createDeleteFileUseCase({ files, guard: createDenyingMembershipGuard() });
    await expect(
      remove({ actorUserId: "user-1", organizationId: "org-1", fileId: "file-1" }),
    ).rejects.toBeInstanceOf(FakeForbiddenError);
    expect(files.rows().get("org-1:file-1")?.status).toBe("stored");
  });
});

describe("list use case", () => {
  test("returns only files with status 'stored'", async () => {
    const files = createFakeFileRepository([
      makeStoredFile({ id: "file-1", name: "a.pdf" }),
      makeStoredFile({ id: "file-2", name: "b.pdf" }),
      makeStoredFile({ id: "file-3", name: "c.pdf" }),
    ]);
    await files.markDeleted({
      organizationId: "org-1",
      id: "file-2",
      deletedAt: new Date("2026-08-03T13:00:00.000Z"),
    });
    const list = createListFilesUseCase({ files, guard: createAllowAllMembershipGuard() });

    const result = await list({ actorUserId: "user-1", organizationId: "org-1" });
    expect(result.map((file) => file.id)).toEqual(["file-1", "file-3"]);
  });

  test("respects the limit and defaults it when omitted", async () => {
    const files = createFakeFileRepository([
      makeStoredFile({ id: "file-1", name: "a.pdf" }),
      makeStoredFile({ id: "file-2", name: "b.pdf" }),
      makeStoredFile({ id: "file-3", name: "c.pdf" }),
      makeStoredFile({ id: "file-4", name: "d.pdf" }),
      makeStoredFile({ id: "file-5", name: "e.pdf" }),
    ]);
    const list = createListFilesUseCase({ files, guard: createAllowAllMembershipGuard() });

    expect((await list({ actorUserId: "user-1", organizationId: "org-1", limit: 2 })).length).toBe(
      2,
    );
    expect((await list({ actorUserId: "user-1", organizationId: "org-1" })).length).toBe(5);
  });

  test("propagates membership guard denials", async () => {
    const files = createFakeFileRepository([makeStoredFile()]);
    const list = createListFilesUseCase({ files, guard: createDenyingMembershipGuard() });
    await expect(list({ actorUserId: "user-1", organizationId: "org-1" })).rejects.toBeInstanceOf(
      FakeForbiddenError,
    );
  });
});
