import { and, eq } from "drizzle-orm";

import type { CreateInvitationInput, InvitationRepository } from "../application/ports";
import { InvitationNotFoundError } from "../domain/organization.errors";
import type { DbOrTransaction } from "./db";
import { rowToInvitation } from "./invitation.mapper";
import { invitations } from "./organization.schema";

export function createInvitationRepository(db: DbOrTransaction): InvitationRepository {
  return {
    async findById(input: { organizationId: string; id: string }) {
      const [row] = await db
        .select()
        .from(invitations)
        .where(
          and(eq(invitations.organizationId, input.organizationId), eq(invitations.id, input.id)),
        );
      return row === undefined ? null : rowToInvitation(row);
    },
    async findByTokenHash(tokenHash: string) {
      const [row] = await db.select().from(invitations).where(eq(invitations.tokenHash, tokenHash));
      return row === undefined ? null : rowToInvitation(row);
    },
    async listByOrganization(organizationId: string) {
      const rows = await db
        .select()
        .from(invitations)
        .where(eq(invitations.organizationId, organizationId))
        .orderBy(invitations.createdAt, invitations.id);
      return rows.map(rowToInvitation);
    },
    async create(input: CreateInvitationInput) {
      const [row] = await db.insert(invitations).values(input).returning();
      if (row === undefined) {
        throw new Error("insert returned no rows");
      }
      return rowToInvitation(row);
    },
    async markUsed(id: string, usedAt: Date) {
      const [row] = await db
        .update(invitations)
        .set({ usedAt })
        .where(eq(invitations.id, id))
        .returning();
      if (row === undefined) {
        throw new InvitationNotFoundError(id);
      }
      return rowToInvitation(row);
    },
    async delete(input: { organizationId: string; id: string }) {
      await db
        .delete(invitations)
        .where(
          and(eq(invitations.organizationId, input.organizationId), eq(invitations.id, input.id)),
        );
    },
  };
}
