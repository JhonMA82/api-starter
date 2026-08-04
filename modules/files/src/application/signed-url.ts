import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * HMAC-signed download tokens for files (spec §15). Token format:
 *   <base64url(JSON { fileId, organizationId, exp (unix seconds) })>.<HMAC-SHA256(secret, base64urlPayload) hex>
 * The payload is deterministic (no random component), so tokens are stable
 * for a given (file, organization, expiry) triple; the HMAC signature binds
 * the claims to the server secret. The file id and organization id live
 * INSIDE the token, so the public download route needs no session: the token
 * is the authorization, tenant-scoped by the embedded organizationId.
 */
export interface SignedUrlInput {
  fileId: string;
  organizationId: string;
  expiresAt: Date;
}

export interface SignedUrlClaims {
  fileId: string;
  organizationId: string;
  /** Unix seconds at which the token expires. */
  exp: number;
}

const SEPARATOR = ".";
const HMAC_HEX_LENGTH = 64;

function encodePayload(input: SignedUrlInput): string {
  const claims: SignedUrlClaims = {
    fileId: input.fileId,
    organizationId: input.organizationId,
    exp: Math.floor(input.expiresAt.getTime() / 1_000),
  };
  return Buffer.from(JSON.stringify(claims)).toString("base64url");
}

/**
 * `<base64url(payload)>.<hex(HMAC-SHA256(secret, base64url(payload)))>`.
 * URL-safe by construction: base64url uses [-_] and no padding, so the token
 * needs no further encoding inside query strings.
 */
export function createSignedDownloadToken(secret: string, input: SignedUrlInput): string {
  const payload = encodePayload(input);
  const signature = createHmac("sha256", secret).update(payload).digest("hex");
  return `${payload}${SEPARATOR}${signature}`;
}

/**
 * Extracts the claims of a token WITHOUT verifying them (signature or expiry).
 * Returns null for a malformed token (wrong shape, non-JSON payload, missing
 * fields). The caller MUST verify with verifySignedDownloadToken before using
 * the claims — the payload is attacker-controlled until then.
 */
export function decodeSignedDownloadToken(token: string): SignedUrlClaims | null {
  if (typeof token !== "string" || token.length === 0) {
    return null;
  }
  const separatorIndex = token.lastIndexOf(SEPARATOR);
  if (separatorIndex <= 0) {
    return null;
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(token.slice(0, separatorIndex), "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof decoded !== "object" || decoded === null) {
    return null;
  }
  const claims = decoded as Partial<SignedUrlClaims>;
  if (
    typeof claims.fileId !== "string" ||
    typeof claims.organizationId !== "string" ||
    typeof claims.exp !== "number" ||
    !Number.isFinite(claims.exp)
  ) {
    return null;
  }
  return { fileId: claims.fileId, organizationId: claims.organizationId, exp: claims.exp };
}

/**
 * Timing-safe verification. Recomputes the HMAC over the token's payload with
 * the server secret and compares in constant time; then checks that the
 * embedded claims match the caller's expectation and that exp > now. Returns
 * false — never throws — for malformed tokens, mismatched claims, a wrong
 * secret, or expired tokens.
 */
export function verifySignedDownloadToken(
  secret: string,
  token: string,
  input: Omit<SignedUrlInput, "expiresAt"> & { now: Date },
): boolean {
  const claims = decodeSignedDownloadToken(token);
  if (claims === null) {
    return false;
  }
  const separatorIndex = token.lastIndexOf(SEPARATOR);
  const payload = token.slice(0, separatorIndex);
  const providedHex = token.slice(separatorIndex + 1);
  if (providedHex.length !== HMAC_HEX_LENGTH || !/^[0-9a-f]+$/.test(providedHex)) {
    return false;
  }
  const expected = createHmac("sha256", secret).update(payload).digest();
  // Both buffers are exactly 32 bytes (sha256), so timingSafeEqual never throws.
  if (!timingSafeEqual(expected, Buffer.from(providedHex, "hex"))) {
    return false;
  }
  if (claims.fileId !== input.fileId || claims.organizationId !== input.organizationId) {
    return false;
  }
  return claims.exp > input.now.getTime() / 1_000;
}

/**
 * Public download URL for a signed token:
 * `<baseUrl>/api/v1/files/download?token=<token>`. baseUrl is the public API
 * origin (e.g. https://api.example.com) — no trailing slash required.
 */
export function buildSignedDownloadUrl(
  baseUrl: string,
  secret: string,
  input: SignedUrlInput,
): string {
  const token = createSignedDownloadToken(secret, input);
  return `${baseUrl.replace(/\/+$/, "")}/api/v1/files/download?${new URLSearchParams({ token })}`;
}
