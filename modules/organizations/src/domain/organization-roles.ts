import { InvalidOrganizationRoleError } from "./organization.errors";

export const ORGANIZATION_ROLES = ["owner", "admin", "auditor", "member"] as const;

export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];

export function isOrganizationRole(value: string): value is OrganizationRole {
  return (ORGANIZATION_ROLES as readonly string[]).includes(value);
}

export function assertValidOrganizationRole(role: string): void {
  if (!isOrganizationRole(role)) {
    throw new InvalidOrganizationRoleError(role);
  }
}
