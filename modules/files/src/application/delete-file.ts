import type { StoredFile } from "../domain/file.entity";
import { FileNotFoundError } from "../domain/file.errors";
import type { FileRepository, MembershipGuard } from "./ports";

export interface DeleteFileDeps {
  files: FileRepository;
  guard: MembershipGuard;
}

export interface DeleteFileInput {
  actorUserId: string;
  organizationId: string;
  fileId: string;
}

export type DeleteFileUseCase = ReturnType<typeof createDeleteFileUseCase>;

/**
 * Soft-delete only: marks the row as deleted. The blob is NOT removed from
 * storage here — hard deletion runs later in a retention job (future WU) that
 * uses findByStorageKey + storage.delete.
 */
export function createDeleteFileUseCase(deps: DeleteFileDeps) {
  return async (input: DeleteFileInput): Promise<StoredFile> => {
    await deps.guard.assertCanManage(input.actorUserId, input.organizationId);

    const file = await deps.files.findById({
      organizationId: input.organizationId,
      id: input.fileId,
    });
    if (file === null) {
      throw new FileNotFoundError(input.fileId);
    }

    return deps.files.markDeleted({
      organizationId: input.organizationId,
      id: input.fileId,
      deletedAt: new Date(),
    });
  };
}
