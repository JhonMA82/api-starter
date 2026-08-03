import { type ApiKey, isApiKeyActive } from "../domain/api-key.entity";
import { hashApiKeySecret } from "./api-key-token";
import type { ApiKeyRepository } from "./ports";

export interface VerifyApiKeyDeps {
  apiKeys: ApiKeyRepository;
}

export interface VerifyApiKeyInput {
  secret: string;
}

export type VerifyApiKeyUseCase = ReturnType<typeof verifyApiKeyUseCase>;

export function verifyApiKeyUseCase(deps: VerifyApiKeyDeps) {
  return async (input: VerifyApiKeyInput): Promise<ApiKey | null> => {
    const apiKey = await deps.apiKeys.findByKeyHash(hashApiKeySecret(input.secret));
    if (apiKey === null || !isApiKeyActive(apiKey, new Date())) {
      return null;
    }
    try {
      await deps.apiKeys.markUsed(apiKey.id, new Date());
    } catch {
      /* last-used tracking is best-effort */
    }
    return apiKey;
  };
}
