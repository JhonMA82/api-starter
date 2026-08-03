import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";

import { acceptInvitationUseCase } from "../src/application/accept-invitation";
import { createOrganizationUseCase } from "../src/application/create-organization";
import { inviteMemberUseCase } from "../src/application/invite-member";
import { suspendOrganizationUseCase } from "../src/application/suspend-organization";
import { createInvitationToken, hashInvitationToken } from "../src/application/token";
import { transferOwnershipUseCase } from "../src/application/transfer-ownership";
import type { Invitation } from "../src/domain/invitation.entity";
import {
  ForbiddenOrganizationActionError,
  InactiveMembershipError,
  InvalidOrganizationRoleError,
  InvitationAlreadyUsedError,
  InvitationEmailError,
  InvitationExpiredError,
  InvitationNotFoundError,
  MembershipNotFoundError,
  OrganizationNameError,
  OrganizationNotFoundError,
  OrganizationSlugError,
  OrganizationSuspendedError,
  OwnerConstraintError,
} from "../src/domain/organization.errors";
import type { OrganizationRole } from "../src/domain/organization-roles";
import {
  createFakeRepositories,
  createFakeUnitOfWork,
  type FakeRepositories,
  makeMembership,
  makeOrganization,
  NOW,
} from "./fakes";

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

describe("createOrganizationUseCase", () => {
  test("creates the organization and the owner membership", async () => {
    const repos = createFakeRepositories();
    const useCase = createOrganizationUseCase({
      organizations: repos.organizations,
      memberships: repos.memberships,
    });

    const org = await useCase({ name: "Acme Inc", slug: "acme-inc", ownerUserId: "user-1" });

    expect(repos.organizationStore.get(org.id)).toEqual(org);
    expect(org.status).toBe("active");
    const [membership] = [...repos.membershipStore.values()];
    expect(membership).toMatchObject({
      organizationId: org.id,
      userId: "user-1",
      role: "owner",
      status: "active",
    });
  });

  test("rejects a duplicate slug with OrganizationSlugError", async () => {
    const repos = createFakeRepositories();
    repos.organizationStore.set("org-1", makeOrganization());
    const useCase = createOrganizationUseCase({
      organizations: repos.organizations,
      memberships: repos.memberships,
    });

    await expect(
      useCase({ name: "Other", slug: "acme-inc", ownerUserId: "user-2" }),
    ).rejects.toThrow(OrganizationSlugError);
    expect(repos.membershipStore.size).toBe(0);
  });

  test("rejects a blank name with OrganizationNameError", async () => {
    const repos = createFakeRepositories();
    const useCase = createOrganizationUseCase({
      organizations: repos.organizations,
      memberships: repos.memberships,
    });

    await expect(useCase({ name: "   ", slug: "acme-inc", ownerUserId: "user-1" })).rejects.toThrow(
      OrganizationNameError,
    );
    expect(repos.organizationStore.size).toBe(0);
  });

  test("rejects an invalid slug with OrganizationSlugError", async () => {
    const repos = createFakeRepositories();
    const useCase = createOrganizationUseCase({
      organizations: repos.organizations,
      memberships: repos.memberships,
    });

    await expect(
      useCase({ name: "Acme", slug: "Acme_Inc!", ownerUserId: "user-1" }),
    ).rejects.toThrow(OrganizationSlugError);
    expect(repos.organizationStore.size).toBe(0);
  });
});

describe("inviteMemberUseCase", () => {
  function setup(actorRole: OrganizationRole = "admin") {
    const repos = createFakeRepositories();
    repos.organizationStore.set("org-1", makeOrganization());
    repos.membershipStore.set("membership-1", makeMembership({ role: actorRole }));
    const useCase = inviteMemberUseCase({
      organizations: repos.organizations,
      memberships: repos.memberships,
      invitations: repos.invitations,
    });
    return { repos, useCase };
  }

  test("creates an invitation with a hashed token expiring in 7 days", async () => {
    const { repos, useCase } = setup("admin");

    const result = await useCase({
      actorUserId: "user-1",
      organizationId: "org-1",
      email: "invitee@example.com",
      role: "member",
    });

    expect(result.token.length).toBe(64);
    expect(result.invitation.tokenHash).toBe(hashInvitationToken(result.token));
    expect(result.invitation.tokenHash).not.toBe(result.token);
    expect(result.invitation).toMatchObject({
      organizationId: "org-1",
      email: "invitee@example.com",
      role: "member",
      usedAt: null,
    });
    const expectedExpiry = Date.now() + INVITATION_TTL_MS;
    expect(Math.abs(result.invitation.expiresAt.getTime() - expectedExpiry)).toBeLessThan(5000);
    expect(repos.invitationStore.size).toBe(1);
  });

  test("allows an owner actor to invite", async () => {
    const { useCase } = setup("owner");

    const result = await useCase({
      actorUserId: "user-1",
      organizationId: "org-1",
      email: "invitee@example.com",
      role: "admin",
    });

    expect(result.invitation.role).toBe("admin");
  });

  test("rejects a non-owner/non-admin actor with ForbiddenOrganizationActionError", async () => {
    const { useCase } = setup("member");

    await expect(
      useCase({
        actorUserId: "user-1",
        organizationId: "org-1",
        email: "invitee@example.com",
        role: "member",
      }),
    ).rejects.toThrow(ForbiddenOrganizationActionError);
  });

  test("throws OrganizationNotFoundError when the organization is missing", async () => {
    const repos = createFakeRepositories();
    const useCase = inviteMemberUseCase({
      organizations: repos.organizations,
      memberships: repos.memberships,
      invitations: repos.invitations,
    });

    await expect(
      useCase({
        actorUserId: "user-1",
        organizationId: "missing-org",
        email: "invitee@example.com",
        role: "member",
      }),
    ).rejects.toThrow(OrganizationNotFoundError);
  });

  test("throws OrganizationSuspendedError when the organization is suspended", async () => {
    const repos = createFakeRepositories();
    repos.organizationStore.set("org-1", makeOrganization({ status: "suspended" }));
    repos.membershipStore.set("membership-1", makeMembership({ role: "admin" }));
    const useCase = inviteMemberUseCase({
      organizations: repos.organizations,
      memberships: repos.memberships,
      invitations: repos.invitations,
    });

    await expect(
      useCase({
        actorUserId: "user-1",
        organizationId: "org-1",
        email: "invitee@example.com",
        role: "member",
      }),
    ).rejects.toThrow(OrganizationSuspendedError);
  });

  test("throws MembershipNotFoundError when the actor is not a member", async () => {
    const repos = createFakeRepositories();
    repos.organizationStore.set("org-1", makeOrganization());
    const useCase = inviteMemberUseCase({
      organizations: repos.organizations,
      memberships: repos.memberships,
      invitations: repos.invitations,
    });

    await expect(
      useCase({
        actorUserId: "stranger",
        organizationId: "org-1",
        email: "invitee@example.com",
        role: "member",
      }),
    ).rejects.toThrow(MembershipNotFoundError);
  });

  test("rejects inviting the owner role with InvalidOrganizationRoleError", async () => {
    const { repos, useCase } = setup("admin");

    await expect(
      useCase({
        actorUserId: "user-1",
        organizationId: "org-1",
        email: "invitee@example.com",
        role: "owner",
      }),
    ).rejects.toThrow(InvalidOrganizationRoleError);
    expect(repos.invitationStore.size).toBe(0);
  });

  test("rejects a blank email with InvitationEmailError", async () => {
    const { repos, useCase } = setup("admin");

    await expect(
      useCase({
        actorUserId: "user-1",
        organizationId: "org-1",
        email: "   ",
        role: "member",
      }),
    ).rejects.toThrow(InvitationEmailError);
    expect(repos.invitationStore.size).toBe(0);
  });
});

describe("createInvitationToken", () => {
  test("returns a raw token that differs from its sha256 hash", () => {
    const { token, tokenHash } = createInvitationToken();

    expect(token.length).toBe(64);
    expect(token).not.toBe(tokenHash);
    expect(tokenHash).toBe(createHash("sha256").update(token).digest("hex"));
  });

  test("produces a different token on each call", () => {
    const first = createInvitationToken();
    const second = createInvitationToken();

    expect(first.token).not.toBe(second.token);
    expect(first.tokenHash).not.toBe(second.tokenHash);
  });
});

describe("acceptInvitationUseCase", () => {
  function setup() {
    const repos = createFakeRepositories();
    const useCase = acceptInvitationUseCase({
      organizations: repos.organizations,
      memberships: repos.memberships,
      invitations: repos.invitations,
    });
    return { repos, useCase };
  }

  async function seedInvitation(
    repos: FakeRepositories,
    overrides: { expiresAt?: Date; usedAt?: Date; role?: OrganizationRole } = {},
  ): Promise<Invitation> {
    const token = "a".repeat(64);
    const invitation = await repos.invitations.create({
      organizationId: "org-1",
      email: "invitee@example.com",
      role: overrides.role ?? "admin",
      tokenHash: hashInvitationToken(token),
      expiresAt: overrides.expiresAt ?? new Date(NOW.getTime() + INVITATION_TTL_MS),
    });
    if (overrides.usedAt !== undefined) {
      return repos.invitations.markUsed(invitation.id, overrides.usedAt);
    }
    return invitation;
  }

  test("creates a membership with the invitation role and marks the invitation used", async () => {
    const { repos, useCase } = setup();
    repos.organizationStore.set("org-1", makeOrganization());
    const seeded = await seedInvitation(repos);

    const membership = await useCase({ token: "a".repeat(64), userId: "user-2" });

    expect(membership).toMatchObject({
      organizationId: "org-1",
      userId: "user-2",
      role: "admin",
      status: "active",
    });
    expect(repos.membershipStore.get(membership.id)).toEqual(membership);
    const stored = repos.invitationStore.get(seeded.id);
    expect(stored?.usedAt).toBeInstanceOf(Date);
  });

  test("throws InvitationNotFoundError for an unknown token", async () => {
    const { repos, useCase } = setup();
    repos.organizationStore.set("org-1", makeOrganization());

    await expect(useCase({ token: "b".repeat(64), userId: "user-2" })).rejects.toThrow(
      InvitationNotFoundError,
    );
  });

  test("throws InvitationExpiredError for an expired invitation", async () => {
    const { repos, useCase } = setup();
    repos.organizationStore.set("org-1", makeOrganization());
    await seedInvitation(repos, {
      expiresAt: new Date(Date.now() - 1000),
    });

    await expect(useCase({ token: "a".repeat(64), userId: "user-2" })).rejects.toThrow(
      InvitationExpiredError,
    );
  });

  test("throws InvitationAlreadyUsedError for a used invitation", async () => {
    const { repos, useCase } = setup();
    repos.organizationStore.set("org-1", makeOrganization());
    await seedInvitation(repos, { usedAt: NOW });

    await expect(useCase({ token: "a".repeat(64), userId: "user-2" })).rejects.toThrow(
      InvitationAlreadyUsedError,
    );
  });

  test("throws OrganizationNotFoundError when the organization is missing", async () => {
    const { repos, useCase } = setup();
    await seedInvitation(repos);

    await expect(useCase({ token: "a".repeat(64), userId: "user-2" })).rejects.toThrow(
      OrganizationNotFoundError,
    );
  });

  test("throws OrganizationSuspendedError when the organization is suspended", async () => {
    const { repos, useCase } = setup();
    repos.organizationStore.set("org-1", makeOrganization({ status: "suspended" }));
    await seedInvitation(repos);

    await expect(useCase({ token: "a".repeat(64), userId: "user-2" })).rejects.toThrow(
      OrganizationSuspendedError,
    );
  });
});

describe("transferOwnershipUseCase", () => {
  function setup() {
    const repos = createFakeRepositories();
    repos.organizationStore.set("org-1", makeOrganization());
    const useCase = transferOwnershipUseCase({
      organizations: repos.organizations,
      memberships: repos.memberships,
    });
    return { repos, useCase };
  }

  test("makes the target owner and demotes the previous owner to admin", async () => {
    const { repos, useCase } = setup();
    repos.membershipStore.set(
      "membership-1",
      makeMembership({ id: "membership-1", userId: "user-1", role: "owner" }),
    );
    repos.membershipStore.set(
      "membership-2",
      makeMembership({ id: "membership-2", userId: "user-2", role: "member" }),
    );

    const result = await useCase({
      actorUserId: "user-1",
      organizationId: "org-1",
      newOwnerUserId: "user-2",
    });

    expect(result.previousOwner).toMatchObject({ userId: "user-1", role: "admin" });
    expect(result.newOwner).toMatchObject({ userId: "user-2", role: "owner" });
    expect(repos.membershipStore.get("membership-1")?.role).toBe("admin");
    expect(repos.membershipStore.get("membership-2")?.role).toBe("owner");
    expect(await repos.memberships.countOwners("org-1")).toBe(1);
  });

  test("throws ForbiddenOrganizationActionError when the actor is not the owner", async () => {
    const { repos, useCase } = setup();
    repos.membershipStore.set("membership-1", makeMembership({ role: "admin" }));
    repos.membershipStore.set(
      "membership-2",
      makeMembership({ id: "membership-2", userId: "user-2", role: "member" }),
    );

    await expect(
      useCase({ actorUserId: "user-1", organizationId: "org-1", newOwnerUserId: "user-2" }),
    ).rejects.toThrow(ForbiddenOrganizationActionError);
  });

  test("throws MembershipNotFoundError when the target is not a member", async () => {
    const { repos, useCase } = setup();
    repos.membershipStore.set(
      "membership-1",
      makeMembership({ id: "membership-1", userId: "user-1", role: "owner" }),
    );

    await expect(
      useCase({ actorUserId: "user-1", organizationId: "org-1", newOwnerUserId: "stranger" }),
    ).rejects.toThrow(MembershipNotFoundError);
  });

  test("throws InactiveMembershipError when the target membership is inactive", async () => {
    const { repos, useCase } = setup();
    repos.membershipStore.set(
      "membership-1",
      makeMembership({ id: "membership-1", userId: "user-1", role: "owner" }),
    );
    repos.membershipStore.set(
      "membership-2",
      makeMembership({ id: "membership-2", userId: "user-2", status: "inactive" }),
    );

    await expect(
      useCase({ actorUserId: "user-1", organizationId: "org-1", newOwnerUserId: "user-2" }),
    ).rejects.toThrow(InactiveMembershipError);
  });

  test("throws OwnerConstraintError when transferring to the actor themselves", async () => {
    const { repos, useCase } = setup();
    repos.membershipStore.set(
      "membership-1",
      makeMembership({ id: "membership-1", userId: "user-1", role: "owner" }),
    );

    await expect(
      useCase({ actorUserId: "user-1", organizationId: "org-1", newOwnerUserId: "user-1" }),
    ).rejects.toThrow(OwnerConstraintError);
  });
});

describe("suspendOrganizationUseCase", () => {
  function setup(actorRole: OrganizationRole = "owner") {
    const repos = createFakeRepositories();
    repos.organizationStore.set("org-1", makeOrganization());
    repos.membershipStore.set("membership-1", makeMembership({ role: actorRole }));
    const useCase = suspendOrganizationUseCase({
      organizations: repos.organizations,
      memberships: repos.memberships,
    });
    return { repos, useCase };
  }

  test("suspends the organization when the owner acts", async () => {
    const { repos, useCase } = setup();

    const org = await useCase({ actorUserId: "user-1", organizationId: "org-1" });

    expect(org.status).toBe("suspended");
    expect(repos.organizationStore.get("org-1")?.status).toBe("suspended");
  });

  test("throws ForbiddenOrganizationActionError for a non-owner actor", async () => {
    const { useCase } = setup("admin");

    await expect(useCase({ actorUserId: "user-1", organizationId: "org-1" })).rejects.toThrow(
      ForbiddenOrganizationActionError,
    );
  });

  test("throws OrganizationNotFoundError when the organization is missing", async () => {
    const repos = createFakeRepositories();
    const useCase = suspendOrganizationUseCase({
      organizations: repos.organizations,
      memberships: repos.memberships,
    });

    await expect(useCase({ actorUserId: "user-1", organizationId: "missing-org" })).rejects.toThrow(
      OrganizationNotFoundError,
    );
  });
});

describe("createOrganizationUseCase with UnitOfWork", () => {
  test("runs both writes inside the provided uow", async () => {
    const repos = createFakeRepositories();
    const { uow, calls } = createFakeUnitOfWork(repos);
    const useCase = createOrganizationUseCase({
      organizations: repos.organizations,
      memberships: repos.memberships,
      uow,
    });

    const org = await useCase({ name: "Acme Inc", slug: "acme-inc", ownerUserId: "user-1" });

    expect(calls).toEqual(["run", "organizations.create", "memberships.create"]);
    expect(repos.organizationStore.get(org.id)?.slug).toBe("acme-inc");
    expect([...repos.membershipStore.values()][0]).toMatchObject({
      organizationId: org.id,
      userId: "user-1",
      role: "owner",
    });
  });

  test("runs writes directly on deps when no uow is provided", async () => {
    const repos = createFakeRepositories();
    const { calls } = createFakeUnitOfWork(repos);
    const useCase = createOrganizationUseCase({
      organizations: repos.organizations,
      memberships: repos.memberships,
    });

    await useCase({ name: "Acme Inc", slug: "acme-inc", ownerUserId: "user-1" });

    expect(calls).toEqual([]);
    expect(repos.organizationStore.size).toBe(1);
    expect(repos.membershipStore.size).toBe(1);
  });

  test("rejects a duplicate slug before entering the uow", async () => {
    const repos = createFakeRepositories();
    repos.organizationStore.set("org-1", makeOrganization());
    const { uow, calls } = createFakeUnitOfWork(repos);
    const useCase = createOrganizationUseCase({
      organizations: repos.organizations,
      memberships: repos.memberships,
      uow,
    });

    await expect(
      useCase({ name: "Other", slug: "acme-inc", ownerUserId: "user-2" }),
    ).rejects.toThrow(OrganizationSlugError);
    expect(calls).toEqual([]);
  });
});
