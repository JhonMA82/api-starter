import type { AuditLogger } from "@consulting/audit";

export type OrganizationAudit = {
  organizationCreated(actorUserId: string, organizationId: string): Promise<void>;
  memberInvited(actorUserId: string, organizationId: string, email: string): Promise<void>;
  invitationAccepted(userId: string, organizationId: string, email: string): Promise<void>;
  ownershipTransferred(
    actorUserId: string,
    organizationId: string,
    previousOwnerUserId: string,
    newOwnerUserId: string,
  ): Promise<void>;
  organizationSuspended(actorUserId: string, organizationId: string): Promise<void>;
  organizationDeleted(actorUserId: string, organizationId: string): Promise<void>;
  memberRemoved(actorUserId: string, organizationId: string, targetUserId: string): Promise<void>;
  apiKeyCreated(
    actorUserId: string,
    organizationId: string,
    metadata: { name: string; prefix: string },
  ): Promise<void>;
  apiKeyRevoked(
    actorUserId: string,
    organizationId: string,
    metadata: { name: string; prefix: string },
  ): Promise<void>;
  webhookRegistered(
    actorUserId: string,
    organizationId: string,
    metadata: { url: string; events: string[] },
  ): Promise<void>;
  webhookSecretRotated(
    actorUserId: string,
    organizationId: string,
    metadata: { url: string },
  ): Promise<void>;
};

export function createOrganizationAudit(audit: AuditLogger): OrganizationAudit {
  return {
    organizationCreated(actorUserId, organizationId) {
      return audit.record({
        actorUserId,
        action: "organization.created",
        resourceType: "organization",
        resourceId: organizationId,
        outcome: "success",
      });
    },
    memberInvited(actorUserId, organizationId, email) {
      return audit.record({
        actorUserId,
        action: "member.invited",
        resourceType: "organization",
        resourceId: organizationId,
        outcome: "success",
        metadata: { email },
      });
    },
    invitationAccepted(userId, organizationId, email) {
      return audit.record({
        actorUserId: userId,
        action: "invitation.accepted",
        resourceType: "organization",
        resourceId: organizationId,
        outcome: "success",
        metadata: { email },
      });
    },
    ownershipTransferred(actorUserId, organizationId, previousOwnerUserId, newOwnerUserId) {
      return audit.record({
        actorUserId,
        action: "ownership.transferred",
        resourceType: "organization",
        resourceId: organizationId,
        outcome: "success",
        metadata: { previousOwnerUserId, newOwnerUserId },
      });
    },
    organizationSuspended(actorUserId, organizationId) {
      return audit.record({
        actorUserId,
        action: "organization.suspended",
        resourceType: "organization",
        resourceId: organizationId,
        outcome: "success",
      });
    },
    organizationDeleted(actorUserId, organizationId) {
      return audit.record({
        actorUserId,
        action: "organization.deleted",
        resourceType: "organization",
        resourceId: organizationId,
        outcome: "success",
      });
    },
    memberRemoved(actorUserId, organizationId, targetUserId) {
      return audit.record({
        actorUserId,
        action: "member.removed",
        resourceType: "organization",
        resourceId: organizationId,
        outcome: "success",
        metadata: { targetUserId },
      });
    },
    apiKeyCreated(actorUserId, organizationId, metadata) {
      return audit.record({
        actorUserId,
        action: "api_key.created",
        resourceType: "api_key",
        resourceId: organizationId,
        outcome: "success",
        metadata,
      });
    },
    apiKeyRevoked(actorUserId, organizationId, metadata) {
      return audit.record({
        actorUserId,
        action: "api_key.revoked",
        resourceType: "api_key",
        resourceId: organizationId,
        outcome: "success",
        metadata,
      });
    },
    webhookRegistered(actorUserId, organizationId, metadata) {
      return audit.record({
        actorUserId,
        action: "webhook.registered",
        resourceType: "webhook_endpoint",
        resourceId: organizationId,
        outcome: "success",
        metadata,
      });
    },
    webhookSecretRotated(actorUserId, organizationId, metadata) {
      return audit.record({
        actorUserId,
        action: "webhook.secret_rotated",
        resourceType: "webhook_endpoint",
        resourceId: organizationId,
        outcome: "success",
        metadata,
      });
    },
  };
}
