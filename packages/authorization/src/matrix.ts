import type { Permission } from "./permissions";
import { PERMISSIONS } from "./permissions";
import type { Role } from "./roles";
import { ROLE_PERMISSIONS, ROLES } from "./roles";

export interface MatrixEntry {
  resource: "request";
  action: Permission;
  admin: boolean;
  reviewer: boolean;
  member: boolean;
}

export const PERMISSION_MATRIX: readonly MatrixEntry[] = PERMISSIONS.map((action) => ({
  resource: "request",
  action,
  admin: ROLE_PERMISSIONS.admin.includes(action),
  reviewer: ROLE_PERMISSIONS.reviewer.includes(action),
  member: ROLE_PERMISSIONS.member.includes(action),
}));

export function rolesForPermission(permission: Permission): Role[] {
  return ROLES.filter((role) => ROLE_PERMISSIONS[role].includes(permission));
}
