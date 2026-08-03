import { and, desc, eq, sql } from "drizzle-orm";

import type { WebhookRepository } from "../application/ports";
import { WebhookEndpointNotFoundError } from "../domain/organization.errors";
import { endpointSubscribesTo } from "../domain/webhook.entity";
import type { DbOrTransaction } from "./db";
import { rowToWebhookDelivery, rowToWebhookEndpoint } from "./webhook.mapper";
import { webhookDeliveries, webhookEndpoints } from "./webhook.schema";

export function createWebhookRepository(db: DbOrTransaction): WebhookRepository {
  const findEndpoint = async (organizationId: string, id: string) => {
    const [row] = await db
      .select()
      .from(webhookEndpoints)
      .where(and(eq(webhookEndpoints.organizationId, organizationId), eq(webhookEndpoints.id, id)));
    return row === undefined ? null : rowToWebhookEndpoint(row);
  };

  return {
    async createEndpoint(input) {
      const [row] = await db
        .insert(webhookEndpoints)
        .values({
          organizationId: input.organizationId,
          url: input.url,
          secret: input.secret,
          events: [...input.events],
        })
        .returning();
      if (row === undefined) {
        throw new Error("insert returned no rows");
      }
      return rowToWebhookEndpoint(row);
    },
    async findEndpointById(input) {
      return findEndpoint(input.organizationId, input.id);
    },
    async listEndpointsByOrganization(organizationId) {
      const rows = await db
        .select()
        .from(webhookEndpoints)
        .where(eq(webhookEndpoints.organizationId, organizationId))
        .orderBy(webhookEndpoints.createdAt, webhookEndpoints.id);
      return rows.map(rowToWebhookEndpoint);
    },
    async findActiveEndpointsByEvent(organizationId, eventType) {
      const rows = await db
        .select()
        .from(webhookEndpoints)
        .where(
          and(
            eq(webhookEndpoints.organizationId, organizationId),
            eq(webhookEndpoints.active, true),
          ),
        );
      return rows
        .map(rowToWebhookEndpoint)
        .filter((endpoint) => endpointSubscribesTo(endpoint, eventType));
    },
    async rotateSecret(input) {
      const [row] = await db
        .update(webhookEndpoints)
        .set({ secret: input.secret, updatedAt: new Date() })
        .where(
          and(
            eq(webhookEndpoints.organizationId, input.organizationId),
            eq(webhookEndpoints.id, input.id),
          ),
        )
        .returning();
      if (row === undefined) {
        throw new WebhookEndpointNotFoundError(input.organizationId, input.id);
      }
      return rowToWebhookEndpoint(row);
    },
    async setActive(input) {
      const [row] = await db
        .update(webhookEndpoints)
        .set({ active: input.active, updatedAt: new Date() })
        .where(
          and(
            eq(webhookEndpoints.organizationId, input.organizationId),
            eq(webhookEndpoints.id, input.id),
          ),
        )
        .returning();
      if (row === undefined) {
        throw new WebhookEndpointNotFoundError(input.organizationId, input.id);
      }
      return rowToWebhookEndpoint(row);
    },
    async createDelivery(input) {
      const [row] = await db
        .insert(webhookDeliveries)
        .values({
          endpointId: input.endpointId,
          eventId: input.eventId,
          payload: input.payload,
          status: "pending",
          attempts: 0,
          lastStatusCode: null,
          lastError: null,
          nextAttemptAt: new Date(),
        })
        .returning();
      if (row === undefined) {
        throw new Error("insert returned no rows");
      }
      return rowToWebhookDelivery(row);
    },
    async findDeliveriesByEndpoint(endpointId, limit) {
      const rows = await db
        .select()
        .from(webhookDeliveries)
        .where(eq(webhookDeliveries.endpointId, endpointId))
        .orderBy(desc(webhookDeliveries.createdAt), desc(webhookDeliveries.id))
        .limit(limit);
      return rows.map(rowToWebhookDelivery);
    },
    async markDeliverySucceeded(id, statusCode) {
      const [row] = await db
        .update(webhookDeliveries)
        .set({
          status: "succeeded",
          lastStatusCode: statusCode,
          lastError: null,
          updatedAt: new Date(),
        })
        .where(eq(webhookDeliveries.id, id))
        .returning();
      if (row === undefined) {
        throw new Error(`delivery not found: ${id}`);
      }
      return rowToWebhookDelivery(row);
    },
    async markDeliveryFailed(id, error, statusCode, nextAttemptAt) {
      const [row] = await db
        .update(webhookDeliveries)
        .set({
          status: "failed",
          attempts: sql`${webhookDeliveries.attempts} + 1`,
          lastStatusCode: statusCode,
          lastError: error,
          nextAttemptAt,
          updatedAt: new Date(),
        })
        .where(eq(webhookDeliveries.id, id))
        .returning();
      if (row === undefined) {
        throw new Error(`delivery not found: ${id}`);
      }
      return rowToWebhookDelivery(row);
    },
  };
}
