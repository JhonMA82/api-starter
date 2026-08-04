import {
  assertAllowedMimeType,
  assertFileSize,
  generateStorageKey,
  type StoredFile,
  sanitizeFileName,
} from "../domain/file.entity";
import { FileStorageUnavailableError } from "../domain/file.errors";
import type { FileHashing, FileRepository, FileStorage, MembershipGuard } from "./ports";

export interface UploadFileDeps {
  files: FileRepository;
  storage: FileStorage;
  hash: FileHashing;
  guard: MembershipGuard;
}

export interface UploadFileInput {
  actorUserId: string;
  organizationId: string;
  name: string;
  mimeType: string;
  data: Buffer;
}

export type UploadFileUseCase = ReturnType<typeof createUploadFileUseCase>;

export function createUploadFileUseCase(deps: UploadFileDeps) {
  return async (input: UploadFileInput): Promise<StoredFile> => {
    await deps.guard.assertCanManage(input.actorUserId, input.organizationId);

    const name = sanitizeFileName(input.name);
    assertAllowedMimeType(input.mimeType);
    assertFileSize(input.data.length);

    const storageKey = generateStorageKey({ organizationId: input.organizationId, fileName: name });
    const sha256 = deps.hash.hash(input.data);

    try {
      await deps.storage.put({ storageKey, data: input.data, mimeType: input.mimeType });
    } catch (error) {
      throw new FileStorageUnavailableError(error);
    }

    return deps.files.create({
      organizationId: input.organizationId,
      ownerUserId: input.actorUserId,
      name,
      storageKey,
      mimeType: input.mimeType,
      sizeBytes: input.data.length,
      sha256,
    });
  };
}
