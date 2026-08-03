import type { Permission } from "./permissions";

export const ROLES = ["admin", "reviewer", "member"] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  admin: [
    "request.create",
    "request.read",
    "request.update",
    "request.assign",
    "request.review",
    "request.approve",
    "request.reject",
    "request.export",
    "request.delete",
  ],
  reviewer: [
    "request.read",
    "request.assign",
    "request.review",
    "request.approve",
    "request.reject",
    "request.export",
  ],
  member: ["request.create", "request.read", "request.update", "request.export"],
};
