import type { DomainEvent } from "../domain/domain-events";
import type { Invitation } from "../domain/invitation.entity";
import type { Membership, MembershipStatus } from "../domain/membership.entity";
import type { Organization, OrganizationStatus } from "../domain/organization.entity";
import type { OrganizationRole } from "../domain/organization-roles";
import type { OutboxRecord } from "../domain/outbox.entity";

export interface CreateOrganizationInput {
  name: string;
  slug: string;
}

export interface CreateMembershipInput {
  organizationId: string;
  userId: string;
  role: OrganizationRole;
}

export interface CreateInvitationInput {
  organizationId: string;
  email: string;
  role: OrganizationRole;
  tokenHash: string;
  expiresAt: Date;
}

export interface OrganizationRepository {
  findById(id: string): Promise<Organization | null>;
  findBySlug(slug: string): Promise<Organization | null>;
  create(input: CreateOrganizationInput): Promise<Organization>;
  updateStatus(id: string, status: OrganizationStatus): Promise<Organization>;
  delete(id: string): Promise<void>;
}

export interface MembershipRepository {
  findById(input: { organizationId: string; id: string }): Promise<Membership | null>;
  findActiveByOrganizationAndUser(
    organizationId: string,
    userId: string,
  ): Promise<Membership | null>;
  findByOrganizationAndUser(organizationId: string, userId: string): Promise<Membership | null>;
  listByOrganization(organizationId: string): Promise<Membership[]>;
  create(input: CreateMembershipInput): Promise<Membership>;
  updateRole(input: {
    organizationId: string;
    id: string;
    role: OrganizationRole;
  }): Promise<Membership>;
  updateStatus(input: {
    organizationId: string;
    id: string;
    status: MembershipStatus;
  }): Promise<Membership>;
  countOwners(organizationId: string): Promise<number>;
  delete(input: { organizationId: string; id: string }): Promise<void>;
}

export interface InvitationRepository {
  findById(input: { organizationId: string; id: string }): Promise<Invitation | null>;
  findByTokenHash(tokenHash: string): Promise<Invitation | null>;
  listByOrganization(organizationId: string): Promise<Invitation[]>;
  create(input: CreateInvitationInput): Promise<Invitation>;
  markUsed(id: string, usedAt: Date): Promise<Invitation>;
  delete(input: { organizationId: string; id: string }): Promise<void>;
}

export interface OutboxRepository {
  append(event: DomainEvent): Promise<void>;
  findPendingDue(limit: number): Promise<OutboxRecord[]>;
  findByEventId(eventId: string): Promise<OutboxRecord | null>;
  markProcessing(id: string): Promise<void>;
  markSucceeded(id: string): Promise<void>;
  markFailed(id: string, error: string, nextAttemptAt?: Date): Promise<void>;
  listByStatus(status: string, limit: number): Promise<OutboxRecord[]>;
  reprocess(id: string): Promise<OutboxRecord>;
  pendingCount(): Promise<number>;
}

export interface UnitOfWork {
  run<T>(work: (uow: UnitOfWork) => Promise<T>): Promise<T>;
  readonly organizations: OrganizationRepository;
  readonly memberships: MembershipRepository;
  readonly invitations: InvitationRepository;
  readonly outbox: OutboxRepository;
}
