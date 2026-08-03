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
  createOrganizationRepository,
  createWebhookRepository,
  WebhookEndpointNotFoundError,
} from "../src";

const databaseUrl = getDatabaseUrl();
const describeDb = databaseUrl === null ? describe.skip : describe;
if (databaseUrl === null) {
  console.warn("[webhook repository tests] DATABASE_URL is not set — skipping real-DB tests");
}

describeDb("webhook repositories (real database)", () => {
  const client = createTestClient(databaseUrl as string);

  beforeAll(async () => {
    await resetDatabase(client);
    await migrateToLatest(client);
  });

  afterAll(async () => {
    await closeClient(client);
  });

  test("endpoint lifecycle: create, find, list, rotate, setActive", async () => {
    const db = createDb(client);
    const organizations = createOrganizationRepository(db);
    const repository = createWebhookRepository(db);
    const organization = await organizations.create({
      name: "Webhooks Org",
      slug: `webhooks-${crypto.randomUUID()}`,
    });

    const created = await repository.createEndpoint({
      organizationId: organization.id,
      url: "https://example.com/hooks",
      secret: "signing-secret",
      events: ["member.invited"],
    });
    expect(created.id).toBeString();
    expect(created.organizationId).toBe(organization.id);
    expect(created.url).toBe("https://example.com/hooks");
    expect(created.secret).toBe("signing-secret");
    expect(created.events).toEqual(["member.invited"]);
    expect(created.active).toBe(true);
    expect(created.createdAt).toBeInstanceOf(Date);
    expect(created.updatedAt).toBeInstanceOf(Date);

    expect(
      await repository.findEndpointById({ organizationId: organization.id, id: created.id }),
    ).toEqual(created);
    expect(
      await repository.findEndpointById({
        organizationId: organization.id,
        id: crypto.randomUUID(),
      }),
    ).toBeNull();

    expect(
      (await repository.listEndpointsByOrganization(organization.id)).map((e) => e.id),
    ).toEqual([created.id]);

    const rotated = await repository.rotateSecret({
      organizationId: organization.id,
      id: created.id,
      secret: "new-secret",
    });
    expect(rotated.secret).toBe("new-secret");
    expect(
      (await repository.findEndpointById({ organizationId: organization.id, id: created.id }))
        ?.secret,
    ).toBe("new-secret");

    const deactivated = await repository.setActive({
      organizationId: organization.id,
      id: created.id,
      active: false,
    });
    expect(deactivated.active).toBe(false);
    expect(
      (await repository.findEndpointById({ organizationId: organization.id, id: created.id }))
        ?.active,
    ).toBe(false);

    await expect(
      repository.rotateSecret({
        organizationId: organization.id,
        id: crypto.randomUUID(),
        secret: "x",
      }),
    ).rejects.toBeInstanceOf(WebhookEndpointNotFoundError);
    await expect(
      repository.setActive({
        organizationId: organization.id,
        id: crypto.randomUUID(),
        active: true,
      }),
    ).rejects.toBeInstanceOf(WebhookEndpointNotFoundError);
  });

  test("endpoints are tenant-scoped (IDOR guard)", async () => {
    const db = createDb(client);
    const organizations = createOrganizationRepository(db);
    const repository = createWebhookRepository(db);
    const orgA = await organizations.create({
      name: "Webhooks Org A",
      slug: `webhooks-a-${crypto.randomUUID()}`,
    });
    const orgB = await organizations.create({
      name: "Webhooks Org B",
      slug: `webhooks-b-${crypto.randomUUID()}`,
    });

    const endpointInB = await repository.createEndpoint({
      organizationId: orgB.id,
      url: "https://b.example.com/hooks",
      secret: "b-secret",
      events: [],
    });

    expect(
      await repository.findEndpointById({ organizationId: orgA.id, id: endpointInB.id }),
    ).toBeNull();
    await expect(
      repository.rotateSecret({ organizationId: orgA.id, id: endpointInB.id, secret: "x" }),
    ).rejects.toBeInstanceOf(WebhookEndpointNotFoundError);
    await expect(
      repository.setActive({ organizationId: orgA.id, id: endpointInB.id, active: false }),
    ).rejects.toBeInstanceOf(WebhookEndpointNotFoundError);
    expect(await repository.listEndpointsByOrganization(orgA.id)).toEqual([]);

    expect(
      await repository.findEndpointById({ organizationId: orgB.id, id: endpointInB.id }),
    ).toEqual(endpointInB);
  });

  test("findActiveEndpointsByEvent filters active endpoints and subscriptions", async () => {
    const db = createDb(client);
    const organizations = createOrganizationRepository(db);
    const repository = createWebhookRepository(db);
    const organization = await organizations.create({
      name: "Filter Org",
      slug: `filter-${crypto.randomUUID()}`,
    });

    const all = await repository.createEndpoint({
      organizationId: organization.id,
      url: "https://example.com/all",
      secret: "s1",
      events: [],
    });
    const scoped = await repository.createEndpoint({
      organizationId: organization.id,
      url: "https://example.com/scoped",
      secret: "s2",
      events: ["member.invited"],
    });
    const inactive = await repository.createEndpoint({
      organizationId: organization.id,
      url: "https://example.com/inactive",
      secret: "s3",
      events: [],
    });
    await repository.setActive({ organizationId: organization.id, id: inactive.id, active: false });

    const forInvite = await repository.findActiveEndpointsByEvent(
      organization.id,
      "member.invited",
    );
    expect(forInvite.map((e) => e.id).sort()).toEqual([all.id, scoped.id].sort());

    const forApiKey = await repository.findActiveEndpointsByEvent(
      organization.id,
      "api_key.created",
    );
    expect(forApiKey.map((e) => e.id)).toEqual([all.id]);
  });

  test("delivery lifecycle: create -> succeed, create -> fail with attempts and backoff", async () => {
    const db = createDb(client);
    const organizations = createOrganizationRepository(db);
    const repository = createWebhookRepository(db);
    const organization = await organizations.create({
      name: "Delivery Org",
      slug: `delivery-${crypto.randomUUID()}`,
    });
    const endpoint = await repository.createEndpoint({
      organizationId: organization.id,
      url: "https://example.com/hooks",
      secret: "s",
      events: [],
    });

    const pending = await repository.createDelivery({
      endpointId: endpoint.id,
      eventId: "event-1",
      payload: { eventId: "event-1", data: { name: "Acme" } },
    });
    expect(pending.status).toBe("pending");
    expect(pending.attempts).toBe(0);
    expect(pending.lastStatusCode).toBeNull();
    expect(pending.nextAttemptAt).toBeInstanceOf(Date);

    const succeeded = await repository.markDeliverySucceeded(pending.id, 200);
    expect(succeeded.status).toBe("succeeded");
    expect(succeeded.lastStatusCode).toBe(200);
    expect(succeeded.lastError).toBeNull();

    const failed = await repository.createDelivery({
      endpointId: endpoint.id,
      eventId: "event-2",
      payload: { eventId: "event-2" },
    });
    const nextAttemptAt = new Date("2026-08-03T13:00:00Z");
    const failedAgain = await repository.markDeliveryFailed(
      failed.id,
      "HTTP 500",
      500,
      nextAttemptAt,
    );
    expect(failedAgain.status).toBe("failed");
    expect(failedAgain.attempts).toBe(1);
    expect(failedAgain.lastStatusCode).toBe(500);
    expect(failedAgain.lastError).toBe("HTTP 500");
    expect(failedAgain.nextAttemptAt.getTime()).toBe(nextAttemptAt.getTime());

    const afterSecondFail = await repository.markDeliveryFailed(
      failed.id,
      "network error",
      null,
      new Date("2026-08-03T14:00:00Z"),
    );
    expect(afterSecondFail.attempts).toBe(2);
    expect(afterSecondFail.lastStatusCode).toBeNull();
    expect(afterSecondFail.nextAttemptAt.getTime()).toBe(
      new Date("2026-08-03T14:00:00Z").getTime(),
    );

    const history = await repository.findDeliveriesByEndpoint(endpoint.id, 10);
    expect(history).toHaveLength(2);
    expect(history.map((d) => d.eventId).sort()).toEqual(["event-1", "event-2"]);
  });

  test("deliveries cascade when their endpoint is deleted, and endpoints cascade on organization delete", async () => {
    const db = createDb(client);
    const organizations = createOrganizationRepository(db);
    const repository = createWebhookRepository(db);
    const organization = await organizations.create({
      name: "Cascade Org",
      slug: `cascade-${crypto.randomUUID()}`,
    });
    const endpoint = await repository.createEndpoint({
      organizationId: organization.id,
      url: "https://example.com/hooks",
      secret: "s",
      events: [],
    });
    await repository.createDelivery({ endpointId: endpoint.id, eventId: "event-1", payload: {} });

    await client.unsafe(`DELETE FROM webhook_endpoints WHERE id = '${endpoint.id}'`);

    expect(await repository.findDeliveriesByEndpoint(endpoint.id, 10)).toEqual([]);
    const deliveryCount = (await client.unsafe<{ count: string }[]>(
      `SELECT count(*)::text AS count FROM webhook_deliveries WHERE endpoint_id = '${endpoint.id}'`,
    )) as unknown as { count: string }[];
    expect(deliveryCount[0]?.count).toBe("0");

    const endpoint2 = await repository.createEndpoint({
      organizationId: organization.id,
      url: "https://example.com/hooks-2",
      secret: "s2",
      events: [],
    });
    await repository.createDelivery({ endpointId: endpoint2.id, eventId: "event-2", payload: {} });

    await organizations.delete(organization.id);

    expect(await repository.listEndpointsByOrganization(organization.id)).toEqual([]);
    expect(await repository.findDeliveriesByEndpoint(endpoint2.id, 10)).toEqual([]);
  });
});
