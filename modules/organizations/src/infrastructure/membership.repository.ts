import { and, count, eq } from "drizzle-orm";

import type { CreateMembershipInput, MembershipRepository } from "../application/ports";
import type { MembershipStatus } from "../domain/membership.entity";
import { MembershipNotFoundError } from "../domain/organization.errors";
import type { OrganizationRole } from "../domain/organization-roles";
import type { DbOrTransaction } from "./db";
import { rowToMembership } from "./membership.mapper";
import { memberships } from "./organization.schema";

export function createMembershipRepository(db: DbOrTransaction): MembershipRepository {
  return {
    async findById(input: { organizationId: string; id: string }) {
      const [row] = await db
        .select()
        .from(memberships)
        .where(
          and(eq(memberships.organizationId, input.organizationId), eq(memberships.id, input.id)),
        );
      return row === undefined ? null : rowToMembership(row);
    },
    async findActiveByOrganizationAndUser(organizationId: string, userId: string) {
      const [row] = await db
        .select()
        .from(memberships)
        .where(
          and(
            eq(memberships.organizationId, organizationId),
            eq(memberships.userId, userId),
            eq(memberships.status, "active"),
          ),
        );
      return row === undefined ? null : rowToMembership(row);
    },
    async findByOrganizationAndUser(organizationId: string, userId: string) {
      const [row] = await db
        .select()
        .from(memberships)
        .where(and(eq(memberships.organizationId, organizationId), eq(memberships.userId, userId)));
      return row === undefined ? null : rowToMembership(row);
    },
    async listByOrganization(organizationId: string) {
      const rows = await db
        .select()
        .from(memberships)
        .where(eq(memberships.organizationId, organizationId))
        .orderBy(memberships.createdAt, memberships.id);
      return rows.map(rowToMembership);
    },
    async create(input: CreateMembershipInput) {
      const [row] = await db.insert(memberships).values(input).returning();
      if (row === undefined) {
        throw new Error("insert returned no rows");
      }
      return rowToMembership(row);
    },
    async updateRole(input: { organizationId: string; id: string; role: OrganizationRole }) {
      const [row] = await db
        .update(memberships)
        .set({ role: input.role, updatedAt: new Date() })
        .where(
          and(eq(memberships.organizationId, input.organizationId), eq(memberships.id, input.id)),
        )
        .returning();
      if (row === undefined) {
        throw new MembershipNotFoundError(input.organizationId, input.id);
      }
      return rowToMembership(row);
    },
    async updateStatus(input: { organizationId: string; id: string; status: MembershipStatus }) {
      const [row] = await db
        .update(memberships)
        .set({ status: input.status, updatedAt: new Date() })
        .where(
          and(eq(memberships.organizationId, input.organizationId), eq(memberships.id, input.id)),
        )
        .returning();
      if (row === undefined) {
        throw new MembershipNotFoundError(input.organizationId, input.id);
      }
      return rowToMembership(row);
    },
    async countOwners(organizationId: string) {
      const [row] = await db
        .select({ count: count() })
        .from(memberships)
        .where(and(eq(memberships.organizationId, organizationId), eq(memberships.role, "owner")));
      return row?.count ?? 0;
    },
    async delete(input: { organizationId: string; id: string }) {
      await db
        .delete(memberships)
        .where(
          and(eq(memberships.organizationId, input.organizationId), eq(memberships.id, input.id)),
        );
    },
  };
}
