import type { AuditEntryInput, AuditLogger } from "@consulting/audit";
import type {
  ApiKeyRepository,
  CreateApiKeyInput,
  CreateInvitationInput,
  CreateMembershipInput,
  CreateOrganizationInput,
  InvitationRepository,
  MembershipRepository,
  OrganizationRepository,
  OutboxRepository,
  UnitOfWork,
} from "../src/application/ports";
import type { ApiKey } from "../src/domain/api-key.entity";
import type { DomainEvent } from "../src/domain/domain-events";
import type { Invitation } from "../src/domain/invitation.entity";
import type { Membership } from "../src/domain/membership.entity";
import type { Organization, OrganizationStatus } from "../src/domain/organization.entity";
import {
  ApiKeyNotFoundError,
  InvitationNotFoundError,
  MembershipNotFoundError,
  OrganizationNotFoundError,
} from "../src/domain/organization.errors";
import type { OrganizationRole } from "../src/domain/organization-roles";
import type { OutboxRecord } from "../src/domain/outbox.entity";
import { OutboxEventNotFoundError } from "../src/domain/outbox.errors";

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

export function makeApiKey(overrides: Partial<ApiKey> = {}): ApiKey {
  return {
    id: "api-key-1",
    organizationId: "org-1",
    name: "CI deploy key",
    prefix: "ak_abc123",
    keyHash: "0".repeat(64),
    expiresAt: null,
    revokedAt: null,
    lastUsedAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

export interface FakeRepositories {
  organizations: OrganizationRepository;
  memberships: MembershipRepository;
  invitations: InvitationRepository;
  apiKeys: ApiKeyRepository;
  outbox: OutboxRepository;
  organizationStore: Map<string, Organization>;
  membershipStore: Map<string, Membership>;
  invitationStore: Map<string, Invitation>;
  apiKeyStore: Map<string, ApiKey>;
  outboxStore: OutboxRecord[];
}

export function createFakeApiKeyRepository(apiKeyStore = new Map<string, ApiKey>()): {
  apiKeys: ApiKeyRepository;
  apiKeyStore: Map<string, ApiKey>;
} {
  const find = (organizationId: string, id: string): ApiKey | null => {
    const key = apiKeyStore.get(id);
    return key !== undefined && key.organizationId === organizationId ? key : null;
  };

  const apiKeys: ApiKeyRepository = {
    async create(input: CreateApiKeyInput) {
      const key: ApiKey = {
        id: `api-key-${apiKeyStore.size + 1}`,
        organizationId: input.organizationId,
        name: input.name,
        prefix: input.prefix,
        keyHash: input.keyHash,
        expiresAt: input.expiresAt,
        revokedAt: null,
        lastUsedAt: null,
        createdAt: NOW,
        updatedAt: NOW,
      };
      apiKeyStore.set(key.id, key);
      return key;
    },
    async findByKeyHash(keyHash: string) {
      return [...apiKeyStore.values()].find((key) => key.keyHash === keyHash) ?? null;
    },
    async findById(input: { organizationId: string; id: string }) {
      return find(input.organizationId, input.id);
    },
    async listByOrganization(organizationId: string) {
      return [...apiKeyStore.values()].filter((key) => key.organizationId === organizationId);
    },
    async revoke(input: { organizationId: string; id: string; revokedAt: Date }) {
      const key = find(input.organizationId, input.id);
      if (key === null) {
        throw new ApiKeyNotFoundError(input.organizationId, input.id);
      }
      const updated = { ...key, revokedAt: input.revokedAt, updatedAt: NOW };
      apiKeyStore.set(input.id, updated);
      return updated;
    },
    async markUsed(id: string, usedAt: Date) {
      const key = apiKeyStore.get(id);
      if (key !== undefined) {
        apiKeyStore.set(id, { ...key, lastUsedAt: usedAt, updatedAt: NOW });
      }
    },
  };

  return { apiKeys, apiKeyStore };
}

export function createFakeOutboxRepository(): {
  outbox: OutboxRepository;
  outboxStore: OutboxRecord[];
} {
  const outboxStore: OutboxRecord[] = [];
  const findIndex = (eventId: string): number =>
    outboxStore.findIndex((record) => record.eventId === eventId);

  const outbox: OutboxRepository = {
    async append(event: DomainEvent) {
      if (findIndex(event.id) !== -1) {
        return;
      }
      const now = new Date();
      outboxStore.push({
        id: crypto.randomUUID(),
        eventId: event.id,
        type: event.type,
        organizationId: event.organizationId,
        actorUserId: event.actorUserId,
        payload: event.payload,
        status: "pending",
        attempts: 0,
        maxAttempts: 5,
        lastError: null,
        nextAttemptAt: now,
        processedAt: null,
        createdAt: now,
        updatedAt: now,
      });
    },
    async findPendingDue(limit: number) {
      const now = new Date();
      return outboxStore
        .filter(
          (record) =>
            record.status === "pending" && record.nextAttemptAt.getTime() <= now.getTime(),
        )
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .slice(0, limit);
    },
    async findByEventId(eventId: string) {
      return outboxStore.find((r) => r.eventId === eventId) ?? null;
    },
    async markProcessing(id: string) {
      const record = outboxStore.find((r) => r.id === id);
      if (record !== undefined) {
        record.status = "processing";
        record.updatedAt = new Date();
      }
    },
    async markSucceeded(id: string) {
      const record = outboxStore.find((r) => r.id === id);
      if (record !== undefined) {
        record.status = "succeeded";
        record.processedAt = new Date();
        record.updatedAt = new Date();
      }
    },
    async markFailed(id: string, error: string, nextAttemptAt?: Date) {
      const record = outboxStore.find((r) => r.id === id);
      if (record === undefined) {
        return;
      }
      record.attempts += 1;
      record.lastError = error;
      record.status = record.attempts >= record.maxAttempts ? "dead_letter" : "failed";
      record.nextAttemptAt = nextAttemptAt ?? new Date();
      record.updatedAt = new Date();
    },
    async listByStatus(status: string, limit: number) {
      return outboxStore
        .filter((record) => record.status === status)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .slice(0, limit);
    },
    async reprocess(id: string) {
      const record = outboxStore.find((r) => r.id === id);
      if (record === undefined) {
        throw new OutboxEventNotFoundError(id);
      }
      record.status = "pending";
      record.attempts = 0;
      record.lastError = null;
      record.nextAttemptAt = new Date();
      record.processedAt = null;
      record.updatedAt = new Date();
      return record;
    },
    async pendingCount() {
      return outboxStore.filter((record) => record.status === "pending").length;
    },
  };

  return { outbox, outboxStore };
}

export function createFakeRepositories(): FakeRepositories {
  const organizationStore = new Map<string, Organization>();
  const membershipStore = new Map<string, Membership>();
  const invitationStore = new Map<string, Invitation>();
  const apiKeyStore = new Map<string, ApiKey>();

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
    async delete(id: string) {
      organizationStore.delete(id);
      for (const [key, membership] of membershipStore) {
        if (membership.organizationId === id) {
          membershipStore.delete(key);
        }
      }
      for (const [key, invitation] of invitationStore) {
        if (invitation.organizationId === id) {
          invitationStore.delete(key);
        }
      }
      for (const [key, apiKey] of apiKeyStore) {
        if (apiKey.organizationId === id) {
          apiKeyStore.delete(key);
        }
      }
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
    apiKeys: createFakeApiKeyRepository(apiKeyStore).apiKeys,
    organizationStore,
    membershipStore,
    invitationStore,
    apiKeyStore,
    ...createFakeOutboxRepository(),
  };
}

export function createFakeAudit(): { audit: AuditLogger; records: AuditEntryInput[] } {
  const records: AuditEntryInput[] = [];
  const audit: AuditLogger = {
    async record(input: AuditEntryInput): Promise<void> {
      records.push(input);
    },
    async list() {
      return [];
    },
  };
  return { audit, records };
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
    apiKeys: {
      ...repos.apiKeys,
      create: async (input: CreateApiKeyInput) => {
        calls.push("apiKeys.create");
        return repos.apiKeys.create(input);
      },
    },
    outbox: {
      ...repos.outbox,
      append: async (event: DomainEvent) => {
        calls.push("outbox.append");
        return repos.outbox.append(event);
      },
    },
  };
  return { uow, calls };
}
