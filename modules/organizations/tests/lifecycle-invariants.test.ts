import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  closeClient,
  createTestClient,
  getDatabaseUrl,
  migrateToLatest,
  resetDatabase,
} from "../../notes/tests/db-test-utils";
import {
  acceptInvitationUseCase,
  createDb,
  createInvitationRepository,
  createMembershipRepository,
  createOrganizationRepository,
  createOrganizationUseCase,
  createTenancyService,
  deleteOrganizationUseCase,
  InactiveMembershipError,
  InvitationAlreadyUsedError,
  InvitationExpiredError,
  inviteMemberUseCase,
  MembershipNotFoundError,
  OrganizationSuspendedError,
  OwnerConstraintError,
  removeMemberUseCase,
  suspendOrganizationUseCase,
  transferOwnershipUseCase,
} from "../src";

const databaseUrl = getDatabaseUrl();
const describeDb = databaseUrl === null ? describe.skip : describe;
if (databaseUrl === null) {
  console.warn(
    "[organizations lifecycle invariants] DATABASE_URL is not set — skipping real-DB tests",
  );
}

describeDb("organization lifecycle invariants (real database)", () => {
  const client = createTestClient(databaseUrl as string);

  beforeAll(async () => {
    await resetDatabase(client);
    await migrateToLatest(client);
  });

  afterAll(async () => {
    await closeClient(client);
  });

  async function insertUser(id: string): Promise<void> {
    await client.unsafe(`
      INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
      VALUES ('${id}', '${id}', '${id}@example.com', true, now(), now())
    `);
  }

  async function createOrg(ownerUserId: string, slugPrefix: string) {
    const organizations = createOrganizationRepository(createDb(client));
    const memberships = createMembershipRepository(createDb(client));
    await insertUser(ownerUserId);
    const org = await createOrganizationUseCase({
      organizations,
      memberships,
    })({ name: "Lifecycle Org", slug: `${slugPrefix}-${crypto.randomUUID()}`, ownerUserId });
    return { organizations, memberships, org };
  }

  test("removing the last owner is blocked (OwnerConstraintError)", async () => {
    const { organizations, memberships, org } = await createOrg(
      "wu5-owner-1",
      "lifecycle-last-owner",
    );

    await expect(
      removeMemberUseCase({ organizations, memberships })({
        actorUserId: "wu5-owner-1",
        organizationId: org.id,
        targetUserId: "wu5-owner-1",
      }),
    ).rejects.toThrow(OwnerConstraintError);

    expect(await organizations.findById(org.id)).not.toBeNull();
    expect(await memberships.findByOrganizationAndUser(org.id, "wu5-owner-1")).not.toBeNull();
  });

  test("after transferring ownership, removing the previous owner succeeds", async () => {
    const { organizations, memberships, org } = await createOrg(
      "wu5-owner-a",
      "lifecycle-transfer",
    );
    await insertUser("wu5-owner-b");
    await memberships.create({
      organizationId: org.id,
      userId: "wu5-owner-b",
      role: "member",
    });

    await transferOwnershipUseCase({ organizations, memberships })({
      actorUserId: "wu5-owner-a",
      organizationId: org.id,
      newOwnerUserId: "wu5-owner-b",
    });

    await removeMemberUseCase({ organizations, memberships })({
      actorUserId: "wu5-owner-b",
      organizationId: org.id,
      targetUserId: "wu5-owner-a",
    });

    expect(await memberships.findByOrganizationAndUser(org.id, "wu5-owner-a")).toBeNull();
    expect((await memberships.findByOrganizationAndUser(org.id, "wu5-owner-b"))?.role).toBe(
      "owner",
    );
    expect(await memberships.countOwners(org.id)).toBe(1);
  });

  test("a suspended organization blocks tenant resolution but its data persists", async () => {
    const { organizations, memberships, org } = await createOrg(
      "wu5-suspend-1",
      "lifecycle-suspend",
    );
    await suspendOrganizationUseCase({ organizations, memberships })({
      actorUserId: "wu5-suspend-1",
      organizationId: org.id,
    });

    const tenancy = createTenancyService({ organizations, memberships });
    await expect(
      tenancy.resolveTenantContext({ organizationId: org.id, userId: "wu5-suspend-1" }),
    ).rejects.toThrow(OrganizationSuspendedError);

    const stored = await organizations.findById(org.id);
    expect(stored).not.toBeNull();
    expect(stored?.status).toBe("suspended");
    expect(await memberships.findByOrganizationAndUser(org.id, "wu5-suspend-1")).not.toBeNull();
  });

  test("an inactive membership does not authorize", async () => {
    const { organizations, memberships, org } = await createOrg(
      "wu5-inactive-1",
      "lifecycle-inactive",
    );
    await insertUser("wu5-inactive-2");
    const membership = await memberships.create({
      organizationId: org.id,
      userId: "wu5-inactive-2",
      role: "member",
    });
    await memberships.updateStatus({
      organizationId: org.id,
      id: membership.id,
      status: "inactive",
    });

    const tenancy = createTenancyService({ organizations, memberships });
    const error = await tenancy
      .resolveTenantContext({ organizationId: org.id, userId: "wu5-inactive-2" })
      .then(
        () => null,
        (err) => err,
      );
    expect(
      error instanceof MembershipNotFoundError || error instanceof InactiveMembershipError,
    ).toBe(true);
  });

  test("an invitation expires and cannot be reused", async () => {
    const { organizations, memberships, org } = await createOrg("wu5-invite-1", "lifecycle-invite");
    const invitations = createInvitationRepository(createDb(client));
    const invite = inviteMemberUseCase({ organizations, memberships, invitations });
    const accept = acceptInvitationUseCase({ organizations, memberships, invitations });

    const first = await invite({
      actorUserId: "wu5-invite-1",
      organizationId: org.id,
      email: "wu5-expired@example.com",
      role: "member",
    });
    await client.unsafe(
      "UPDATE invitations SET expires_at = now() - interval '1 hour' WHERE id = $1",
      [first.invitation.id],
    );
    await insertUser("wu5-invite-2");
    await expect(accept({ token: first.token, userId: "wu5-invite-2" })).rejects.toThrow(
      InvitationExpiredError,
    );

    const second = await invite({
      actorUserId: "wu5-invite-1",
      organizationId: org.id,
      email: "wu5-reuse@example.com",
      role: "member",
    });
    const membership = await accept({ token: second.token, userId: "wu5-invite-2" });
    expect(membership.organizationId).toBe(org.id);
    expect(membership.userId).toBe("wu5-invite-2");

    await expect(accept({ token: second.token, userId: "wu5-invite-2" })).rejects.toThrow(
      InvitationAlreadyUsedError,
    );
  });

  test("deleting an organization with confirmation removes it and cascades", async () => {
    const { organizations, memberships, org } = await createOrg("wu5-delete-1", "lifecycle-delete");
    await insertUser("wu5-delete-2");
    await memberships.create({
      organizationId: org.id,
      userId: "wu5-delete-2",
      role: "member",
    });
    const invitations = createInvitationRepository(createDb(client));
    await invitations.create({
      organizationId: org.id,
      email: "wu5-delete-invite@example.com",
      role: "member",
      tokenHash: `tok-delete-${crypto.randomUUID()}`,
      expiresAt: new Date("2099-01-01T00:00:00Z"),
    });

    await deleteOrganizationUseCase({ organizations, memberships })({
      actorUserId: "wu5-delete-1",
      organizationId: org.id,
      confirm: true,
    });

    expect(await organizations.findById(org.id)).toBeNull();
    const [membershipCount] = await client.unsafe<{ count: number }[]>(
      "SELECT count(*)::int AS count FROM memberships WHERE organization_id = $1",
      [org.id],
    );
    expect(membershipCount?.count).toBe(0);
    const [invitationCount] = await client.unsafe<{ count: number }[]>(
      "SELECT count(*)::int AS count FROM invitations WHERE organization_id = $1",
      [org.id],
    );
    expect(invitationCount?.count).toBe(0);
  });
});
