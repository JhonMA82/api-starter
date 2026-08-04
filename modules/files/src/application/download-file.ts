import type { StoredFile } from "../domain/file.entity";
import { FileNotFoundError } from "../domain/file.errors";
import type { FileRepository, FileStorage, MembershipGuard } from "./ports";

export interface DownloadFileDeps {
  files: FileRepository;
  storage: FileStorage;
  guard: MembershipGuard;
}

export interface DownloadFileInput {
  actorUserId: string;
  organizationId: string;
  fileId: string;
}

export interface DownloadFileResult {
  file: StoredFile;
  data: Buffer;
}

export type DownloadFileUseCase = ReturnType<typeof createDownloadFileUseCase>;

export function createDownloadFileUseCase(deps: DownloadFileDeps) {
  return async (input: DownloadFileInput): Promise<DownloadFileResult> => {
    await deps.guard.assertCanManage(input.actorUserId, input.organizationId);

    const file = await deps.files.findById({
      organizationId: input.organizationId,
      id: input.fileId,
    });
    if (file === null) {
      throw new FileNotFoundError(input.fileId);
    }
    if (file.status === "deleted") {
      throw new FileNotFoundError(input.fileId);
    }

    const data = await deps.storage.get(file.storageKey);
    return { file, data };
  };
}
