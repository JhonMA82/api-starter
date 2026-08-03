import {
  InvitationAlreadyUsedError,
  InvitationEmailError,
  InvitationExpiredError,
} from "./organization.errors";
import type { OrganizationRole } from "./organization-roles";

export interface Invitation {
  id: string;
  organizationId: string;
  email: string;
  role: OrganizationRole;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
}

export function assertValidInvitationEmail(email: string): void {
  if (email.trim() === "") {
    throw new InvitationEmailError("invitation email must not be blank");
  }
}

export function assertInvitationUsable(invitation: Invitation, now: Date): void {
  if (now > invitation.expiresAt) {
    throw new InvitationExpiredError(invitation.id);
  }
  if (invitation.usedAt !== null) {
    throw new InvitationAlreadyUsedError(invitation.id);
  }
}

export function markInvitationUsed(invitation: Invitation, now: Date): Invitation {
  return { ...invitation, usedAt: now };
}
