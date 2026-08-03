import type { Organization, OrganizationStatus } from "../domain/organization.entity";
import type { organizations } from "./organization.schema";

export type OrganizationRow = typeof organizations.$inferSelect;

export function rowToOrganization(row: OrganizationRow): Organization {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: row.status as OrganizationStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
