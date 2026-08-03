import { randomUUID } from "node:crypto";

export type DomainEventType =
  | "organization.created"
  | "member.invited"
  | "invitation.accepted"
  | "ownership.transferred"
  | "organization.suspended"
  | "organization.deleted"
  | "member.removed";

export interface DomainEventBase {
  id: string;
  type: DomainEventType;
  organizationId: string;
  actorUserId: string;
  occurredAt: Date;
  payload: Record<string, unknown>;
}

export interface DomainEvent extends DomainEventBase {}

export function createDomainEvent(input: {
  type: DomainEventType;
  organizationId: string;
  actorUserId: string;
  payload: Record<string, unknown>;
}): DomainEvent {
  return {
    id: randomUUID(),
    type: input.type,
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    occurredAt: new Date(),
    payload: input.payload,
  };
}
