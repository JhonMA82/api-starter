import type { Actor } from "./authorization";
import { authorize } from "./authorization";

export type RequestStatus = "draft" | "submitted" | "approved" | "rejected";

export interface RequestResource {
  id: string;
  ownerId: string;
  status: RequestStatus;
}

export interface RequestPolicyInput {
  actor: Actor;
  request: RequestResource;
}

export function canUpdateRequest({ actor, request }: RequestPolicyInput): boolean {
  return (
    authorize(actor, "request.update") &&
    (actor.id === request.ownerId || request.status === "draft")
  );
}

export function canApproveRequest({ actor, request }: RequestPolicyInput): boolean {
  return (
    authorize(actor, "request.approve") &&
    request.status === "submitted" &&
    actor.id !== request.ownerId
  );
}

export function canDeleteRequest({ actor, request }: RequestPolicyInput): boolean {
  if (!authorize(actor, "request.delete")) {
    return false;
  }
  if (actor.roles.includes("admin")) {
    return true;
  }
  return actor.id === request.ownerId && request.status === "draft";
}
