import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  closeClient,
  createTestClient,
  getDatabaseUrl,
  migrateToLatest,
  resetDatabase,
} from "../../notes/tests/db-test-utils";
import {
  createDb,
  createInvitationRepository,
  createMembershipRepository,
  createOrganizationRepository,
  InvitationNotFoundError,
  MembershipNotFoundError,
  OrganizationNotFoundError,
} from "../src";

const databaseUrl = getDatabaseUrl();
const describeDb = databaseUrl === null ? describe.skip : describe;
if (databaseUrl === null) {
  console.warn("[organizations repository tests] DATABASE_URL is not set — skipping real-DB tests");
}

describeDb("organization repositories (real database)", () => {
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

  test("organization create, findById, findBySlug, updateStatus", async () => {
    const repository = createOrganizationRepository(createDb(client));
    const slug = `acme-${crypto.randomUUID()}`;

    const created = await repository.create({ name: "Acme Inc", slug });

    expect(created.id).toBeString();
    expect(created.name).toBe("Acme Inc");
    expect(created.slug).toBe(slug);
    expect(created.status).toBe("active");
    expect(created.createdAt).toBeInstanceOf(Date);
    expect(created.updatedAt).toBeInstanceOf(Date);

    expect(await repository.findById(created.id)).toEqual(created);
    expect(await repository.findBySlug(slug)).toEqual(created);

    await expect(repository.findById(crypto.randomUUID())).resolves.toBeNull();
    await expect(repository.findBySlug(`missing-${crypto.randomUUID()}`)).resolves.toBeNull();

    const suspended = await repository.updateStatus(created.id, "suspended");
    expect(suspended.status).toBe("suspended");
    expect(suspended.updatedAt.getTime()).toBeGreaterThanOrEqual(created.updatedAt.getTime());
    expect(await repository.findById(created.id)).toEqual(suspended);

    await expect(repository.updateStatus(crypto.randomUUID(), "suspended")).rejects.toBeInstanceOf(
      OrganizationNotFoundError,
    );
  });

  test("membership lifecycle: create, tenant-scoped reads, role/status updates, countOwners", async () => {
    const db = createDb(client);
    const organizations = createOrganizationRepository(db);
    const repository = createMembershipRepository(db);
    const organization = await organizations.create({
      name: "Members Org",
      slug: `members-${crypto.randomUUID()}`,
    });
    await insertUser("members-user-1");
    await insertUser("members-user-2");

    const created = await repository.create({
      organizationId: organization.id,
      userId: "members-user-1",
      role: "member",
    });
    expect(created.id).toBeString();
    expect(created.organizationId).toBe(organization.id);
    expect(created.userId).toBe("members-user-1");
    expect(created.role).toBe("member");
    expect(created.status).toBe("active");

    expect(await repository.findById({ organizationId: organization.id, id: created.id })).toEqual(
      created,
    );
    expect(
      await repository.findActiveByOrganizationAndUser(organization.id, "members-user-1"),
    ).toEqual(created);
    expect(await repository.findByOrganizationAndUser(organization.id, "members-user-1")).toEqual(
      created,
    );

    const owner = await repository.updateRole({
      organizationId: organization.id,
      id: created.id,
      role: "owner",
    });
    expect(owner.role).toBe("owner");
    expect(await repository.countOwners(organization.id)).toBe(1);

    const second = await repository.create({
      organizationId: organization.id,
      userId: "members-user-2",
      role: "member",
    });
    expect(await repository.countOwners(organization.id)).toBe(1);

    const listed = await repository.listByOrganization(organization.id);
    expect(listed).toHaveLength(2);
    expect(listed.map((membership) => membership.id)).toEqual([created.id, second.id]);

    const inactive = await repository.updateStatus({
      organizationId: organization.id,
      id: created.id,
      status: "inactive",
    });
    expect(inactive.status).toBe("inactive");
    expect(
      await repository.findActiveByOrganizationAndUser(organization.id, "members-user-1"),
    ).toBeNull();
    expect(await repository.findByOrganizationAndUser(organization.id, "members-user-1")).toEqual(
      inactive,
    );
  });

  test("membership operations are tenant-scoped (IDOR guard)", async () => {
    const db = createDb(client);
    const organizations = createOrganizationRepository(db);
    const repository = createMembershipRepository(db);
    const orgA = await organizations.create({ name: "Org A", slug: `a-${crypto.randomUUID()}` });
    const orgB = await organizations.create({ name: "Org B", slug: `b-${crypto.randomUUID()}` });
    await insertUser("idor-membership-user");

    const membershipInA = await repository.create({
      organizationId: orgA.id,
      userId: "idor-membership-user",
      role: "member",
    });
    const membershipInB = await repository.create({
      organizationId: orgB.id,
      userId: "idor-membership-user",
      role: "owner",
    });

    expect(await repository.findById({ organizationId: orgA.id, id: membershipInB.id })).toBeNull();
    await expect(
      repository.updateRole({ organizationId: orgA.id, id: membershipInB.id, role: "admin" }),
    ).rejects.toBeInstanceOf(MembershipNotFoundError);
    await expect(
      repository.updateStatus({
        organizationId: orgA.id,
        id: membershipInB.id,
        status: "inactive",
      }),
    ).rejects.toBeInstanceOf(MembershipNotFoundError);

    await repository.delete({ organizationId: orgA.id, id: membershipInB.id });

    expect(
      await repository.findById({ organizationId: orgA.id, id: membershipInA.id }),
    ).not.toBeNull();
    const stillThere = await repository.findById({ organizationId: orgB.id, id: membershipInB.id });
    expect(stillThere).not.toBeNull();
    expect(stillThere).toEqual(membershipInB);
    expect(await repository.countOwners(orgB.id)).toBe(1);
  });

  test("invitation operations are tenant-scoped (IDOR guard); token lookup is global", async () => {
    const db = createDb(client);
    const organizations = createOrganizationRepository(db);
    const repository = createInvitationRepository(db);
    const orgA = await organizations.create({
      name: "Inv Org A",
      slug: `ia-${crypto.randomUUID()}`,
    });
    const orgB = await organizations.create({
      name: "Inv Org B",
      slug: `ib-${crypto.randomUUID()}`,
    });

    const invitationInB = await repository.create({
      organizationId: orgB.id,
      email: "invitee@example.com",
      role: "member",
      tokenHash: `tok-b-${crypto.randomUUID()}`,
      expiresAt: new Date("2099-01-01T00:00:00Z"),
    });

    expect(await repository.findById({ organizationId: orgA.id, id: invitationInB.id })).toBeNull();

    await repository.delete({ organizationId: orgA.id, id: invitationInB.id });

    expect(await repository.findByTokenHash(invitationInB.tokenHash)).not.toBeNull();
    expect(
      await repository.findById({ organizationId: orgB.id, id: invitationInB.id }),
    ).not.toBeNull();
  });

  test("markUsed persists usedAt and unknown id throws InvitationNotFoundError", async () => {
    const db = createDb(client);
    const organizations = createOrganizationRepository(db);
    const repository = createInvitationRepository(db);
    const organization = await organizations.create({
      name: "Mark Used Org",
      slug: `markused-${crypto.randomUUID()}`,
    });

    const first = await repository.create({
      organizationId: organization.id,
      email: "first@example.com",
      role: "admin",
      tokenHash: `tok-first-${crypto.randomUUID()}`,
      expiresAt: new Date("2099-01-01T00:00:00Z"),
    });
    const second = await repository.create({
      organizationId: organization.id,
      email: "second@example.com",
      role: "auditor",
      tokenHash: `tok-second-${crypto.randomUUID()}`,
      expiresAt: new Date("2099-01-01T00:00:00Z"),
    });

    const listed = await repository.listByOrganization(organization.id);
    expect(listed.map((invitation) => invitation.id)).toEqual([first.id, second.id]);

    const usedAt = new Date("2026-02-02T03:04:05Z");
    const updated = await repository.markUsed(first.id, usedAt);
    expect(updated.usedAt).not.toBeNull();
    expect(updated.usedAt?.getTime()).toBe(usedAt.getTime());

    const fetched = await repository.findById({ organizationId: organization.id, id: first.id });
    expect(fetched?.usedAt?.getTime()).toBe(usedAt.getTime());
    expect(
      (await repository.findById({ organizationId: organization.id, id: second.id }))?.usedAt,
    ).toBeNull();

    await expect(repository.markUsed(crypto.randomUUID(), usedAt)).rejects.toBeInstanceOf(
      InvitationNotFoundError,
    );
  });

  test("creating a duplicate (organizationId, userId) membership throws", async () => {
    const db = createDb(client);
    const organizations = createOrganizationRepository(db);
    const repository = createMembershipRepository(db);
    const organization = await organizations.create({
      name: "Dup Org",
      slug: `dup-${crypto.randomUUID()}`,
    });
    await insertUser("dup-membership-user");

    await repository.create({
      organizationId: organization.id,
      userId: "dup-membership-user",
      role: "member",
    });

    await expect(
      repository.create({
        organizationId: organization.id,
        userId: "dup-membership-user",
        role: "admin",
      }),
    ).rejects.toThrow();
  });
});
