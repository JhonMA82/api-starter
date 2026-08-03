import { createAuthClient as createBetterAuthClient } from "better-auth/client";

export function createAuthClient(config: { baseURL: string }) {
  return createBetterAuthClient(config);
}

export type AuthClient = ReturnType<typeof createAuthClient>;
