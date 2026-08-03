import { ApiKeyNameError } from "./organization.errors";

export interface ApiKey {
  id: string;
  organizationId: string;
  name: string;
  prefix: string;
  keyHash: string;
  expiresAt: Date | null;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const API_KEY_NAME_MAX_LENGTH = 100;

export function assertValidApiKeyName(name: string): void {
  if (name.trim() === "") {
    throw new ApiKeyNameError("api key name must not be blank");
  }
  if (name.trim().length > API_KEY_NAME_MAX_LENGTH) {
    throw new ApiKeyNameError(`api key name must be at most ${API_KEY_NAME_MAX_LENGTH} characters`);
  }
}

export function isApiKeyActive(key: ApiKey, now: Date): boolean {
  if (key.revokedAt !== null) {
    return false;
  }
  return key.expiresAt === null || key.expiresAt.getTime() > now.getTime();
}
