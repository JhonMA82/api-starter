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
