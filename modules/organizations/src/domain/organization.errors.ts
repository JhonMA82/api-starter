export class OrganizationNotFoundError extends Error {
  constructor(id: string) {
    super(`Organization not found: ${id}`);
    this.name = "OrganizationNotFoundError";
  }
}

export class OrganizationNameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrganizationNameError";
  }
}

export class OrganizationSlugError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrganizationSlugError";
  }
}

export class InvalidOrganizationRoleError extends Error {
  constructor(role: string, message?: string) {
    super(message ?? `Invalid organization role: ${role}`);
    this.name = "InvalidOrganizationRoleError";
  }
}

export class ForbiddenOrganizationActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForbiddenOrganizationActionError";
  }
}

export class InvitationEmailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvitationEmailError";
  }
}

export class OrganizationSuspendedError extends Error {
  constructor(id: string) {
    super(`Organization is suspended: ${id}`);
    this.name = "OrganizationSuspendedError";
  }
}

export class MembershipNotFoundError extends Error {
  constructor(organizationId: string, userId: string) {
    super(`Membership not found: organization ${organizationId}, user ${userId}`);
    this.name = "MembershipNotFoundError";
  }
}

export class InactiveMembershipError extends Error {
  constructor(membershipId: string) {
    super(`Membership is not active: ${membershipId}`);
    this.name = "InactiveMembershipError";
  }
}

export class InvitationNotFoundError extends Error {
  constructor(tokenHash: string) {
    super(`Invitation not found: ${tokenHash}`);
    this.name = "InvitationNotFoundError";
  }
}

export class InvitationExpiredError extends Error {
  constructor(id: string) {
    super(`Invitation expired: ${id}`);
    this.name = "InvitationExpiredError";
  }
}

export class InvitationAlreadyUsedError extends Error {
  constructor(id: string) {
    super(`Invitation already used: ${id}`);
    this.name = "InvitationAlreadyUsedError";
  }
}

export class OwnerConstraintError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OwnerConstraintError";
  }
}

export class OrganizationDeletionRequiresConfirmationError extends Error {
  constructor() {
    super("deleting an organization requires strong confirmation");
    this.name = "OrganizationDeletionRequiresConfirmationError";
  }
}

export class ApiKeyNotFoundError extends Error {
  constructor(organizationId: string, id: string) {
    super(`Api key not found: organization ${organizationId}, key ${id}`);
    this.name = "ApiKeyNotFoundError";
  }
}

export class ApiKeyNameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiKeyNameError";
  }
}

export class WebhookUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookUrlError";
  }
}

export class WebhookEventTypeError extends Error {
  constructor(eventType: string) {
    super(`Invalid webhook event type: ${eventType}`);
    this.name = "WebhookEventTypeError";
  }
}

export class WebhookEndpointNotFoundError extends Error {
  constructor(organizationId: string, id: string) {
    super(`Webhook endpoint not found: organization ${organizationId}, endpoint ${id}`);
    this.name = "WebhookEndpointNotFoundError";
  }
}

export class WebhookNotActiveError extends Error {
  constructor(id: string) {
    super(`Webhook endpoint is not active: ${id}`);
    this.name = "WebhookNotActiveError";
  }
}

export class IncomingWebhookError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IncomingWebhookError";
  }
}

export class InvalidWebhookProviderError extends IncomingWebhookError {
  constructor(provider: string) {
    super(`Invalid webhook provider: ${provider}`);
    this.name = "InvalidWebhookProviderError";
  }
}

export class IncomingWebhookEventIdError extends IncomingWebhookError {
  constructor(message: string) {
    super(message);
    this.name = "IncomingWebhookEventIdError";
  }
}

/**
 * The provider has no signing secret configured. The HTTP layer answers 404
 * for these (and for unknown providers) so the outside world cannot probe
 * which providers exist.
 */
export class ProviderNotConfiguredError extends IncomingWebhookError {
  constructor(provider: string) {
    super(`Webhook provider is not configured: ${provider}`);
    this.name = "ProviderNotConfiguredError";
  }
}

export class InvalidWebhookSignatureError extends IncomingWebhookError {
  constructor() {
    super("webhook signature verification failed");
    this.name = "InvalidWebhookSignatureError";
  }
}
