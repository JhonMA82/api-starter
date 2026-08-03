import type {
  CreateInvitationInput,
  CreateMembershipInput,
  CreateOrganizationInput,
  InvitationRepository,
  MembershipRepository,
  OrganizationRepository,
  UnitOfWork,
} from "../src/application/ports";
import type { Invitation } from "../src/domain/invitation.entity";
import type { Membership } from "../src/domain/membership.entity";
import type { Organization, OrganizationStatus } from "../src/domain/organization.entity";
import {
  InvitationNotFoundError,
  MembershipNotFoundError,
  OrganizationNotFoundError,
} from "../src/domain/organization.errors";
import type { OrganizationRole } from "../src/domain/organization-roles";

export const NOW = new Date("2026-08-03T12:00:00.000Z");

export function makeOrganization(overrides: Partial<Organization> = {}): Organization {
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

export function makeMembership(overrides: Partial<Membership> = {}): Membership {
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

export interface FakeRepositories {
  organizations: OrganizationRepository;
  memberships: MembershipRepository;
  invitations: InvitationRepository;
  organizationStore: Map<string, Organization>;
  membershipStore: Map<string, Membership>;
  invitationStore: Map<string, Invitation>;
}

export function createFakeRepositories(): FakeRepositories {
  const organizationStore = new Map<string, Organization>();
  const membershipStore = new Map<string, Membership>();
  const invitationStore = new Map<string, Invitation>();

  const organizations: OrganizationRepository = {
    async findById(id: string) {
      return organizationStore.get(id) ?? null;
    },
    async findBySlug(slug: string) {
      return [...organizationStore.values()].find((org) => org.slug === slug) ?? null;
    },
    async create(input: CreateOrganizationInput) {
      const org: Organization = {
        id: `org-${organizationStore.size + 1}`,
        name: input.name,
        slug: input.slug,
        status: "active",
        createdAt: NOW,
        updatedAt: NOW,
      };
      organizationStore.set(org.id, org);
      return org;
    },
    async updateStatus(id: string, status: OrganizationStatus) {
      const org = organizationStore.get(id);
      if (org === undefined) {
        throw new OrganizationNotFoundError(id);
      }
      const updated = { ...org, status, updatedAt: NOW };
      organizationStore.set(id, updated);
      return updated;
    },
  };

  const findMembershipByOrgUser = (organizationId: string, userId: string): Membership | null =>
    [...membershipStore.values()].find(
      (membership) => membership.organizationId === organizationId && membership.userId === userId,
    ) ?? null;

  const memberships: MembershipRepository = {
    async findById(input: { organizationId: string; id: string }) {
      const membership = membershipStore.get(input.id);
      return membership !== undefined && membership.organizationId === input.organizationId
        ? membership
        : null;
    },
    async findActiveByOrganizationAndUser(organizationId: string, userId: string) {
      const membership = findMembershipByOrgUser(organizationId, userId);
      return membership !== null && membership.status === "active" ? membership : null;
    },
    async findByOrganizationAndUser(organizationId: string, userId: string) {
      return findMembershipByOrgUser(organizationId, userId);
    },
    async listByOrganization(organizationId: string) {
      return [...membershipStore.values()].filter(
        (membership) => membership.organizationId === organizationId,
      );
    },
    async create(input: CreateMembershipInput) {
      if (findMembershipByOrgUser(input.organizationId, input.userId) !== null) {
        throw new Error("membership already exists");
      }
      const membership: Membership = {
        id: `membership-${membershipStore.size + 1}`,
        organizationId: input.organizationId,
        userId: input.userId,
        role: input.role,
        status: "active",
        createdAt: NOW,
        updatedAt: NOW,
      };
      membershipStore.set(membership.id, membership);
      return membership;
    },
    async updateRole(input: { organizationId: string; id: string; role: OrganizationRole }) {
      const membership = membershipStore.get(input.id);
      if (membership === undefined || membership.organizationId !== input.organizationId) {
        throw new MembershipNotFoundError(input.organizationId, input.id);
      }
      const updated = { ...membership, role: input.role, updatedAt: NOW };
      membershipStore.set(input.id, updated);
      return updated;
    },
    async updateStatus(input: {
      organizationId: string;
      id: string;
      status: "active" | "inactive";
    }) {
      const membership = membershipStore.get(input.id);
      if (membership === undefined || membership.organizationId !== input.organizationId) {
        throw new MembershipNotFoundError(input.organizationId, input.id);
      }
      const updated = { ...membership, status: input.status, updatedAt: NOW };
      membershipStore.set(input.id, updated);
      return updated;
    },
    async countOwners(organizationId: string) {
      return [...membershipStore.values()].filter(
        (membership) => membership.organizationId === organizationId && membership.role === "owner",
      ).length;
    },
    async delete(input: { organizationId: string; id: string }) {
      const membership = membershipStore.get(input.id);
      if (membership !== undefined && membership.organizationId === input.organizationId) {
        membershipStore.delete(input.id);
      }
    },
  };

  const invitations: InvitationRepository = {
    async findById(input: { organizationId: string; id: string }) {
      const invitation = invitationStore.get(input.id);
      return invitation !== undefined && invitation.organizationId === input.organizationId
        ? invitation
        : null;
    },
    async findByTokenHash(tokenHash: string) {
      return (
        [...invitationStore.values()].find((invitation) => invitation.tokenHash === tokenHash) ??
        null
      );
    },
    async listByOrganization(organizationId: string) {
      return [...invitationStore.values()].filter(
        (invitation) => invitation.organizationId === organizationId,
      );
    },
    async create(input: CreateInvitationInput) {
      const invitation: Invitation = {
        id: `invitation-${invitationStore.size + 1}`,
        organizationId: input.organizationId,
        email: input.email,
        role: input.role,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
        usedAt: null,
        createdAt: NOW,
      };
      invitationStore.set(invitation.id, invitation);
      return invitation;
    },
    async markUsed(id: string, usedAt: Date) {
      const invitation = invitationStore.get(id);
      if (invitation === undefined) {
        throw new InvitationNotFoundError(id);
      }
      const updated = { ...invitation, usedAt };
      invitationStore.set(id, updated);
      return updated;
    },
    async delete(input: { organizationId: string; id: string }) {
      const invitation = invitationStore.get(input.id);
      if (invitation !== undefined && invitation.organizationId === input.organizationId) {
        invitationStore.delete(input.id);
      }
    },
  };

  return {
    organizations,
    memberships,
    invitations,
    organizationStore,
    membershipStore,
    invitationStore,
  };
}

export function createFakeUnitOfWork(repos: FakeRepositories): {
  uow: UnitOfWork;
  calls: string[];
} {
  const calls: string[] = [];
  const uow: UnitOfWork = {
    async run<T>(work: (uow: UnitOfWork) => Promise<T>): Promise<T> {
      calls.push("run");
      return work(uow);
    },
    organizations: {
      ...repos.organizations,
      create: async (input: CreateOrganizationInput) => {
        calls.push("organizations.create");
        return repos.organizations.create(input);
      },
    },
    memberships: {
      ...repos.memberships,
      create: async (input: CreateMembershipInput) => {
        calls.push("memberships.create");
        return repos.memberships.create(input);
      },
    },
    invitations: repos.invitations,
  };
  return { uow, calls };
}
