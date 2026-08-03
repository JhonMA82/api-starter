import { createHash, randomBytes } from "node:crypto";

export interface GeneratedApiKeySecret {
  secret: string;
  prefix: string;
  keyHash: string;
}

export function generateApiKeySecret(): GeneratedApiKeySecret {
  const secret = randomBytes(32).toString("base64url");
  return { secret, prefix: secret.slice(0, 8), keyHash: hashApiKeySecret(secret) };
}

export function hashApiKeySecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}
