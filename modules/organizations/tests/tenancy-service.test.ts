import { describe, expect, test } from "bun:test";
import type { TenancyDeps } from "../src/application/tenancy-service";
import { createTenancyService } from "../src/application/tenancy-service";
import type { Membership } from "../src/domain/membership.entity";
import type { Organization } from "../src/domain/organization.entity";
import {
  InactiveMembershipError,
  MembershipNotFoundError,
  OrganizationNotFoundError,
  OrganizationSuspendedError,
} from "../src/domain/organization.errors";

function makeOrganization(overrides: Partial<Organization> = {}): Organization {
  return {
    id: "org-1",
    name: "Acme Inc",
    slug: "acme-inc",
    status: "active",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

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

function makeDeps(overrides: Partial<TenancyDeps> = {}): TenancyDeps {
  return {
    organizations: {
      findById: async () => null,
    },
    memberships: {
      findActiveByOrganizationAndUser: async () => null,
    },
    ...overrides,
  };
}

const resolveInput = { organizationId: "org-1", userId: "user-1" };

describe("createTenancyService.resolveTenantContext", () => {
  test("resolves an active organization with an active membership", async () => {
    const service = createTenancyService(
      makeDeps({
        organizations: { findById: async () => makeOrganization() },
        memberships: {
          findActiveByOrganizationAndUser: async () => makeMembership({ role: "admin" }),
        },
      }),
    );

    const context = await service.resolveTenantContext(resolveInput);

    expect(context).toEqual({
      organizationId: "org-1",
      membershipId: "membership-1",
      userId: "user-1",
      roleIds: ["admin"],
    });
  });

  test("resolves a membership without an explicit role as a single-role context", async () => {
    const service = createTenancyService(
      makeDeps({
        organizations: { findById: async () => makeOrganization() },
        memberships: {
          findActiveByOrganizationAndUser: async () => makeMembership(),
        },
      }),
    );

    const context = await service.resolveTenantContext(resolveInput);

    expect(context.roleIds).toEqual(["member"]);
  });

  test("throws OrganizationNotFoundError when the organization does not exist", async () => {
    const service = createTenancyService(makeDeps());

    await expect(service.resolveTenantContext(resolveInput)).rejects.toThrow(
      OrganizationNotFoundError,
    );
  });

  test("throws OrganizationSuspendedError when the organization is suspended", async () => {
    const service = createTenancyService(
      makeDeps({
        organizations: {
          findById: async () => makeOrganization({ status: "suspended" }),
        },
      }),
    );

    await expect(service.resolveTenantContext(resolveInput)).rejects.toThrow(
      OrganizationSuspendedError,
    );
  });

  test("throws MembershipNotFoundError when the user has no membership", async () => {
    const service = createTenancyService(
      makeDeps({
        organizations: { findById: async () => makeOrganization() },
      }),
    );

    await expect(service.resolveTenantContext(resolveInput)).rejects.toThrow(
      MembershipNotFoundError,
    );
  });

  test("throws InactiveMembershipError when the membership is inactive", async () => {
    const service = createTenancyService(
      makeDeps({
        organizations: { findById: async () => makeOrganization() },
        memberships: {
          findActiveByOrganizationAndUser: async () => makeMembership({ status: "inactive" }),
        },
      }),
    );

    await expect(service.resolveTenantContext(resolveInput)).rejects.toThrow(
      InactiveMembershipError,
    );
  });
});
