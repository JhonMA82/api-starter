import type { Permission } from "./permissions";
import type { Role } from "./roles";
import { ROLE_PERMISSIONS } from "./roles";

export interface Actor {
  id: string;
  roles: readonly Role[];
}

export function authorize(actor: Actor, permission: Permission): boolean {
  return actor.roles.some((role) => ROLE_PERMISSIONS[role]?.includes(permission) === true);
}

export class AuthorizationError extends Error {
  readonly actorId: string;
  readonly permission: Permission;

  constructor(actor: Actor, permission: Permission) {
    super(`Denied permission "${permission}" for actor "${actor.id}"`);
    this.name = "AuthorizationError";
    this.actorId = actor.id;
    this.permission = permission;
  }
}
