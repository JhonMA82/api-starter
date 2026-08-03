import type { ApiKey } from "../domain/api-key.entity";
import type { DomainEvent, DomainEventType } from "../domain/domain-events";
import type { IncomingWebhook } from "../domain/incoming-webhook.entity";
import type { Invitation } from "../domain/invitation.entity";
import type { Membership, MembershipStatus } from "../domain/membership.entity";
import type { Organization, OrganizationStatus } from "../domain/organization.entity";
import type { OrganizationRole } from "../domain/organization-roles";
import type { OutboxRecord } from "../domain/outbox.entity";
import type { WebhookDelivery, WebhookEndpoint } from "../domain/webhook.entity";

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

export interface CreateApiKeyInput {
  organizationId: string;
  name: string;
  prefix: string;
  keyHash: string;
  expiresAt: Date | null;
}

export interface ApiKeyRepository {
  create(input: CreateApiKeyInput): Promise<ApiKey>;
  findByKeyHash(keyHash: string): Promise<ApiKey | null>;
  findById(input: { organizationId: string; id: string }): Promise<ApiKey | null>;
  listByOrganization(organizationId: string): Promise<ApiKey[]>;
  revoke(input: { organizationId: string; id: string; revokedAt: Date }): Promise<ApiKey>;
  markUsed(id: string, usedAt: Date): Promise<void>;
}

export interface WebhookRepository {
  createEndpoint(input: {
    organizationId: string;
    url: string;
    secret: string;
    events: readonly DomainEventType[];
  }): Promise<WebhookEndpoint>;
  findEndpointById(input: { organizationId: string; id: string }): Promise<WebhookEndpoint | null>;
  listEndpointsByOrganization(organizationId: string): Promise<WebhookEndpoint[]>;
  findActiveEndpointsByEvent(
    organizationId: string,
    eventType: DomainEventType,
  ): Promise<WebhookEndpoint[]>;
  rotateSecret(input: {
    organizationId: string;
    id: string;
    secret: string;
  }): Promise<WebhookEndpoint>;
  setActive(input: {
    organizationId: string;
    id: string;
    active: boolean;
  }): Promise<WebhookEndpoint>;
  createDelivery(input: {
    endpointId: string;
    eventId: string;
    payload: Record<string, unknown>;
  }): Promise<WebhookDelivery>;
  findDeliveriesByEndpoint(endpointId: string, limit: number): Promise<WebhookDelivery[]>;
  markDeliverySucceeded(id: string, statusCode: number): Promise<WebhookDelivery>;
  markDeliveryFailed(
    id: string,
    error: string,
    statusCode: number | null,
    nextAttemptAt: Date,
  ): Promise<WebhookDelivery>;
}

export interface IncomingWebhookRepository {
  /**
   * INSERT ... ON CONFLICT (provider, event_id) DO NOTHING. `created` is true
   * when the row was inserted now; false means a duplicate delivery for the
   * same provider+event id (idempotency) — the existing row is returned.
   */
  createIfAbsent(input: {
    provider: string;
    eventId: string;
    payload: Record<string, unknown>;
    signatureValid: boolean;
  }): Promise<{ created: boolean; webhook: IncomingWebhook }>;
  findByProviderAndEventId(provider: string, eventId: string): Promise<IncomingWebhook | null>;
  findById(id: string): Promise<IncomingWebhook | null>;
  markProcessing(id: string): Promise<void>;
  markProcessed(id: string): Promise<void>;
  markFailed(id: string): Promise<void>;
}

export interface UnitOfWork {
  run<T>(work: (uow: UnitOfWork) => Promise<T>): Promise<T>;
  readonly organizations: OrganizationRepository;
  readonly memberships: MembershipRepository;
  readonly invitations: InvitationRepository;
  readonly apiKeys: ApiKeyRepository;
  readonly webhooks: WebhookRepository;
  readonly outbox: OutboxRepository;
  readonly incomingWebhooks: IncomingWebhookRepository;
}
