import { describe, expect, test } from "bun:test";
import type { Invitation } from "../src/domain/invitation.entity";
import { assertInvitationUsable, markInvitationUsed } from "../src/domain/invitation.entity";
import type { Membership } from "../src/domain/membership.entity";
import { assertMembershipCanAuthorize } from "../src/domain/membership.entity";
import { assertValidOrganizationName, assertValidSlug } from "../src/domain/organization.entity";
import {
  InactiveMembershipError,
  InvalidOrganizationRoleError,
  InvitationAlreadyUsedError,
  InvitationExpiredError,
  InvitationNotFoundError,
  MembershipNotFoundError,
  OrganizationNameError,
  OrganizationNotFoundError,
  OrganizationSlugError,
  OrganizationSuspendedError,
  OwnerConstraintError,
} from "../src/domain/organization.errors";
import {
  assertValidOrganizationRole,
  isOrganizationRole,
  ORGANIZATION_ROLES,
} from "../src/domain/organization-roles";
import { createTenantContext } from "../src/domain/tenant-context";

describe("assertValidOrganizationName", () => {
  test("rejects a blank name", () => {
    expect(() => assertValidOrganizationName("")).toThrow(OrganizationNameError);
    expect(() => assertValidOrganizationName("   ")).toThrow(OrganizationNameError);
    expect(() => assertValidOrganizationName("\t\n ")).toThrow(OrganizationNameError);
  });

  test("accepts a non-blank name", () => {
    expect(() => assertValidOrganizationName("Acme Inc")).not.toThrow();
    expect(() => assertValidOrganizationName("  Acme  ")).not.toThrow();
  });
});

describe("assertValidSlug", () => {
  test("rejects a blank slug", () => {
    expect(() => assertValidSlug("")).toThrow(OrganizationSlugError);
    expect(() => assertValidSlug("   ")).toThrow(OrganizationSlugError);
  });

  test("rejects slugs that are not kebab-case", () => {
    expect(() => assertValidSlug("Acme")).toThrow(OrganizationSlugError);
    expect(() => assertValidSlug("acme_inc")).toThrow(OrganizationSlugError);
    expect(() => assertValidSlug("acme inc")).toThrow(OrganizationSlugError);
    expect(() => assertValidSlug("-acme")).toThrow(OrganizationSlugError);
    expect(() => assertValidSlug("acme-")).toThrow(OrganizationSlugError);
    expect(() => assertValidSlug("acme--inc")).toThrow(OrganizationSlugError);
    expect(() => assertValidSlug("á")).toThrow(OrganizationSlugError);
  });

  test("accepts kebab-case slugs", () => {
    expect(() => assertValidSlug("acme")).not.toThrow();
    expect(() => assertValidSlug("acme-inc")).not.toThrow();
    expect(() => assertValidSlug("a1-b2-c3")).not.toThrow();
  });
});

describe("organization roles", () => {
  test("catalog contains owner, admin, auditor and member", () => {
    expect(ORGANIZATION_ROLES).toEqual(["owner", "admin", "auditor", "member"]);
  });

  test("isOrganizationRole recognizes the four catalog roles", () => {
    for (const role of ORGANIZATION_ROLES) {
      expect(isOrganizationRole(role)).toBe(true);
    }
    expect(isOrganizationRole("super-admin")).toBe(false);
    expect(isOrganizationRole("")).toBe(false);
  });

  test("assertValidOrganizationRole accepts catalog roles and rejects others", () => {
    for (const role of ORGANIZATION_ROLES) {
      expect(() => assertValidOrganizationRole(role)).not.toThrow();
    }
    expect(() => assertValidOrganizationRole("boss")).toThrow(InvalidOrganizationRoleError);
  });
});

describe("assertMembershipCanAuthorize", () => {
  function makeMembership(overrides: Partial<Membership> = {}): Membership {
    return {
      id: "membership-1",
      organizationId: "org-1",
      userId: "user-1",
      role: "member",
      status: "active",
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z"),
      ...overrides,
    };
  }

  test("accepts an active membership", () => {
    expect(() => assertMembershipCanAuthorize(makeMembership())).not.toThrow();
  });

  test("rejects an inactive membership", () => {
    expect(() => assertMembershipCanAuthorize(makeMembership({ status: "inactive" }))).toThrow(
      InactiveMembershipError,
    );
  });
});

describe("assertInvitationUsable", () => {
  function makeInvitation(overrides: Partial<Invitation> = {}): Invitation {
    return {
      id: "invitation-1",
      organizationId: "org-1",
      email: "jane@example.com",
      role: "member",
      tokenHash: "token-hash-1",
      expiresAt: new Date("2026-02-01T00:00:00Z"),
      usedAt: null,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      ...overrides,
    };
  }

  const now = new Date("2026-01-15T00:00:00Z");

  test("accepts an unused invitation before expiry", () => {
    expect(() => assertInvitationUsable(makeInvitation(), now)).not.toThrow();
  });

  test("accepts an unused invitation exactly at expiry", () => {
    const invitation = makeInvitation({ expiresAt: now });
    expect(() => assertInvitationUsable(invitation, now)).not.toThrow();
  });

  test("rejects an expired invitation", () => {
    const invitation = makeInvitation({ expiresAt: new Date("2026-01-10T00:00:00Z") });
    expect(() => assertInvitationUsable(invitation, now)).toThrow(InvitationExpiredError);
  });

  test("rejects an already-used invitation", () => {
    const invitation = makeInvitation({ usedAt: new Date("2026-01-02T00:00:00Z") });
    expect(() => assertInvitationUsable(invitation, now)).toThrow(InvitationAlreadyUsedError);
  });
});

describe("markInvitationUsed", () => {
  test("returns a copy with usedAt set to now and does not mutate the input", () => {
    const invitation: Invitation = {
      id: "invitation-1",
      organizationId: "org-1",
      email: "jane@example.com",
      role: "owner",
      tokenHash: "token-hash-1",
      expiresAt: new Date("2026-02-01T00:00:00Z"),
      usedAt: null,
      createdAt: new Date("2026-01-01T00:00:00Z"),
    };
    const now = new Date("2026-01-15T00:00:00Z");

    const marked = markInvitationUsed(invitation, now);

    expect(marked).toEqual({ ...invitation, usedAt: now });
    expect(marked).not.toBe(invitation);
    expect(invitation.usedAt).toBeNull();
  });
});

describe("createTenantContext", () => {
  test("builds a context with copied role ids", () => {
    const roleIds = ["owner"];
    const context = createTenantContext({
      organizationId: "org-1",
      membershipId: "membership-1",
      userId: "user-1",
      roleIds,
    });

    expect(context).toEqual({
      organizationId: "org-1",
      membershipId: "membership-1",
      userId: "user-1",
      roleIds: ["owner"],
    });

    roleIds.push("admin");
    expect(context.roleIds).toEqual(["owner"]);
  });
});

describe("organization error classes", () => {
  test("carry their class name", () => {
    const cases = [
      new OrganizationNotFoundError("org-1"),
      new OrganizationNameError("bad name"),
      new OrganizationSlugError("bad slug"),
      new InvalidOrganizationRoleError("boss"),
      new OrganizationSuspendedError("org-1"),
      new MembershipNotFoundError("org-1", "user-1"),
      new InactiveMembershipError("membership-1"),
      new InvitationNotFoundError("token-hash-1"),
      new InvitationExpiredError("invitation-1"),
      new InvitationAlreadyUsedError("invitation-1"),
      new OwnerConstraintError("owner cannot leave without transfer"),
    ];
    for (const error of cases) {
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe(error.constructor.name);
    }
  });
});
