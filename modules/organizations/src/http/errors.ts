import { HTTPException } from "hono/http-exception";

import {
  ApiKeyNameError,
  ApiKeyNotFoundError,
  ForbiddenOrganizationActionError,
  InactiveMembershipError,
  InvalidOrganizationRoleError,
  InvitationAlreadyUsedError,
  InvitationEmailError,
  InvitationExpiredError,
  InvitationNotFoundError,
  MembershipNotFoundError,
  OrganizationDeletionRequiresConfirmationError,
  OrganizationNameError,
  OrganizationNotFoundError,
  OrganizationSlugError,
  OrganizationSuspendedError,
  OwnerConstraintError,
  WebhookEndpointNotFoundError,
  WebhookEventTypeError,
  WebhookNotActiveError,
  WebhookUrlError,
} from "../domain/organization.errors";

/**
 * Maps domain errors to HTTP exceptions so the app-level onError handler can
 * normalize them into problem+json (400 -> VALIDATION_FAILED, 401 -> UNAUTHORIZED,
 * 403 -> FORBIDDEN, 404 -> NOT_FOUND, 409 -> CONFLICT). Unknown errors pass
 * through unchanged and surface as 500 INTERNAL_ERROR.
 */
export function toHttpException(error: unknown): unknown {
  if (error instanceof HTTPException) {
    return error;
  }
  if (error instanceof OrganizationNotFoundError || error instanceof InvitationNotFoundError) {
    return new HTTPException(404);
  }
  if (error instanceof ApiKeyNotFoundError || error instanceof WebhookEndpointNotFoundError) {
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
  if (error instanceof OrganizationSlugError) {
    return new HTTPException(409);
  }
  if (
    error instanceof OrganizationNameError ||
    error instanceof InvitationEmailError ||
    error instanceof InvalidOrganizationRoleError ||
    error instanceof InvitationExpiredError ||
    error instanceof InvitationAlreadyUsedError ||
    error instanceof OwnerConstraintError ||
    error instanceof OrganizationDeletionRequiresConfirmationError ||
    error instanceof ApiKeyNameError ||
    error instanceof WebhookUrlError ||
    error instanceof WebhookEventTypeError ||
    error instanceof WebhookNotActiveError
  ) {
    return new HTTPException(400);
  }
  return error;
}
