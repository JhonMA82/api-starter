import type { UnitOfWork } from "../application/ports";
import { createApiKeyRepository } from "./api-key.repository";
import type { DbOrTransaction, DbTransaction } from "./db";
import { createIncomingWebhookRepository } from "./incoming-webhook.repository";
import { createInvitationRepository } from "./invitation.repository";
import { createMembershipRepository } from "./membership.repository";
import { createOrganizationRepository } from "./organization.repository";
import { createOutboxRepository } from "./outbox.repository";
import { createWebhookRepository } from "./webhook.repository";

export function createUnitOfWork(db: DbOrTransaction): UnitOfWork {
  return {
    run<T>(work: (uow: UnitOfWork) => Promise<T>): Promise<T> {
      return db.transaction((tx: DbTransaction) => work(createUnitOfWork(tx)));
    },
    organizations: createOrganizationRepository(db),
    memberships: createMembershipRepository(db),
    invitations: createInvitationRepository(db),
    apiKeys: createApiKeyRepository(db),
    webhooks: createWebhookRepository(db),
    outbox: createOutboxRepository(db),
    incomingWebhooks: createIncomingWebhookRepository(db),
  };
}
