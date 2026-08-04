import type { StoredFile } from "../domain/file.entity";
import type { FileRepository, MembershipGuard } from "./ports";

export interface ListFilesDeps {
  files: FileRepository;
  guard: MembershipGuard;
}

export interface ListFilesInput {
  actorUserId: string;
  organizationId: string;
  limit?: number;
}

export type ListFilesUseCase = ReturnType<typeof createListFilesUseCase>;

const DEFAULT_LIST_LIMIT = 50;

export function createListFilesUseCase(deps: ListFilesDeps) {
  return async (input: ListFilesInput): Promise<StoredFile[]> => {
    await deps.guard.assertCanManage(input.actorUserId, input.organizationId);

    // Only status "stored" files are listed; the repository query filters them.
    return deps.files.listByOrganization(input.organizationId, input.limit ?? DEFAULT_LIST_LIMIT);
  };
}
