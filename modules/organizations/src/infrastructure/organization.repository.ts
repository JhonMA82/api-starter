import { eq } from "drizzle-orm";

import type { CreateOrganizationInput, OrganizationRepository } from "../application/ports";
import type { OrganizationStatus } from "../domain/organization.entity";
import { OrganizationNotFoundError } from "../domain/organization.errors";
import type { DbOrTransaction } from "./db";
import { rowToOrganization } from "./organization.mapper";
import { organizations } from "./organization.schema";

export function createOrganizationRepository(db: DbOrTransaction): OrganizationRepository {
  return {
    async findById(id: string) {
      const [row] = await db.select().from(organizations).where(eq(organizations.id, id));
      return row === undefined ? null : rowToOrganization(row);
    },
    async findBySlug(slug: string) {
      const [row] = await db.select().from(organizations).where(eq(organizations.slug, slug));
      return row === undefined ? null : rowToOrganization(row);
    },
    async create(input: CreateOrganizationInput) {
      const [row] = await db.insert(organizations).values(input).returning();
      if (row === undefined) {
        throw new Error("insert returned no rows");
      }
      return rowToOrganization(row);
    },
    async updateStatus(id: string, status: OrganizationStatus) {
      const [row] = await db
        .update(organizations)
        .set({ status, updatedAt: new Date() })
        .where(eq(organizations.id, id))
        .returning();
      if (row === undefined) {
        throw new OrganizationNotFoundError(id);
      }
      return rowToOrganization(row);
    },
    async delete(id: string) {
      await db.delete(organizations).where(eq(organizations.id, id));
    },
  };
}
