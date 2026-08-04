import {
  ForbiddenOrganizationActionError,
  InactiveMembershipError,
  MembershipNotFoundError,
  OrganizationNotFoundError,
  OrganizationSuspendedError,
} from "@consulting/module-organizations";
import { HTTPException } from "hono/http-exception";

import {
  FileNotFoundError,
  FileStorageUnavailableError,
  FileTooLargeError,
  InvalidFileNameError,
  UnsupportedMimeTypeError,
} from "../domain/file.errors";

/**
 * Maps files-module domain errors AND the organizations guard errors to HTTP
 * exceptions so the app-level onError handler can normalize them into
 * problem+json (400 -> VALIDATION_FAILED, 401 -> UNAUTHORIZED, 403 -> FORBIDDEN,
 * 404 -> NOT_FOUND, 503 -> INTERNAL_ERROR code with 503 status). Unknown errors
 * pass through unchanged and surface as 500 INTERNAL_ERROR.
 *
 * The guard is wired to the organizations tenancy service, whose
 * resolveTenantContext throws organizations domain errors (see
 * modules/organizations/src/application/tenancy-service.ts); those must be
 * mapped here because the files router catches and rethrows through this
 * mapper. The mapping mirrors the organizations convention (orgs/memberships
 * errors in modules/organizations/src/http/errors.ts).
 */
export function toFileHttpException(error: unknown): unknown {
  if (error instanceof HTTPException) {
    return error;
  }
  if (error instanceof FileNotFoundError) {
    return new HTTPException(404);
  }
  if (
    error instanceof FileTooLargeError ||
    error instanceof UnsupportedMimeTypeError ||
    error instanceof InvalidFileNameError
  ) {
    return new HTTPException(400);
  }
  if (error instanceof FileStorageUnavailableError) {
    return new HTTPException(503);
  }
  if (error instanceof OrganizationNotFoundError) {
    return new HTTPException(404);
  }
  if (
    error instanceof OrganizationSuspendedError ||
    error instanceof MembershipNotFoundError ||
    error instanceof InactiveMembershipError ||
    error instanceof ForbiddenOrganizationActionError
  ) {
    return new HTTPException(403);
  }
  return error;
}
