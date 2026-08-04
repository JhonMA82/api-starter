import { FileTooLargeError, InvalidFileNameError, UnsupportedMimeTypeError } from "./file.errors";

export interface StoredFile {
  id: string;
  organizationId: string;
  ownerUserId: string;
  /** Original client name (sanitized: basename only, no path separators). */
  name: string;
  /** Server-generated key: "<orgId>/<uuid>/<sanitized-name>". */
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  /** Content hash (sha256 hex). */
  sha256: string;
  status: "stored" | "deleted";
  createdAt: Date;
  deletedAt: Date | null;
}

export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MiB

export const ALLOWED_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
  "text/plain",
  "application/json",
] as const;

export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

const SANITIZED_NAME_MAX_LENGTH = 200;
const PATH_SEPARATORS = /[\\/]/;

function isControlCharacter(char: string): boolean {
  const code = char.charCodeAt(0);
  return code < 32 || code === 127;
}

/**
 * Reduces a client-supplied file name to a safe basename: strips any path
 * separators (posix and windows), removes control characters, caps the length
 * at 200 characters and falls back to "file" when nothing remains.
 */
export function sanitizeFileName(name: string): string {
  if (typeof name !== "string") {
    throw new InvalidFileNameError("file name must be a string");
  }
  const segments = name.split(PATH_SEPARATORS);
  let base = segments[segments.length - 1] ?? "";
  base = [...base].filter((char) => !isControlCharacter(char)).join("");
  if (base.length > SANITIZED_NAME_MAX_LENGTH) {
    base = base.slice(0, SANITIZED_NAME_MAX_LENGTH);
  }
  if (base.trim() === "") {
    return "file";
  }
  return base;
}

/**
 * Server-generated storage key: "<orgId>/<uuid>/<sanitized-name>". The UUID
 * makes every key unique so files never collide even with identical names.
 */
export function generateStorageKey(input: { organizationId: string; fileName: string }): string {
  return `${input.organizationId}/${crypto.randomUUID()}/${sanitizeFileName(input.fileName)}`;
}

export function assertAllowedMimeType(mimeType: string): void {
  if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(mimeType)) {
    throw new UnsupportedMimeTypeError(mimeType);
  }
}

export function assertFileSize(sizeBytes: number): void {
  if (sizeBytes > MAX_FILE_SIZE_BYTES) {
    throw new FileTooLargeError(sizeBytes, MAX_FILE_SIZE_BYTES);
  }
}
