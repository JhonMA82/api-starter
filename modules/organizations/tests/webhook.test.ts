import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";

import {
  computeWebhookNextAttemptAt,
  createWebhookDeliverer,
} from "../src/application/deliver-webhook";
import { listWebhooksUseCase } from "../src/application/list-webhooks";
import { createOrganizationAudit } from "../src/application/organization-audit";
import { registerWebhookUseCase } from "../src/application/register-webhook";
import { rotateWebhookSecretUseCase } from "../src/application/rotate-webhook-secret";
import { toggleWebhookUseCase } from "../src/application/toggle-webhook";
import { createWebhookOutboxHandler } from "../src/application/webhook-outbox-handler";
import { createWebhookSecret } from "../src/application/webhook-token";
import { createDomainEvent, type DomainEvent } from "../src/domain/domain-events";
import {
  ForbiddenOrganizationActionError,
  MembershipNotFoundError,
  OrganizationNotFoundError,
  OrganizationSuspendedError,
  WebhookEndpointNotFoundError,
  WebhookEventTypeError,
  WebhookNotActiveError,
  WebhookUrlError,
} from "../src/domain/organization.errors";
import {
  assertValidWebhookUrl,
  endpointSubscribesTo,
  normalizeEventTypes,
  redactSensitiveKeys,
  type WebhookDelivery,
  type WebhookEndpoint,
} from "../src/domain/webhook.entity";
import {
  createFakeAudit,
  createFakeRepositories,
  makeMembership,
  makeOrganization,
  makeWebhookDelivery,
  makeWebhookEndpoint,
} from "./fakes";

const FIXED_NOW = new Date("2026-08-03T12:00:00.000Z");

function makeEvent(overrides: Partial<DomainEvent> = {}): DomainEvent {
  return createDomainEvent({
    type: "organization.created",
    organizationId: "org-1",
    actorUserId: "user-1",
    payload: { name: "Acme Inc" },
    ...overrides,
  });
}

describe("assertValidWebhookUrl", () => {
  test("accepts absolute http(s) URLs", () => {
    expect(() => assertValidWebhookUrl("https://example.com/hooks")).not.toThrow();
    expect(() => assertValidWebhookUrl("http://localhost:8080/callback")).not.toThrow();
  });

  test.each(["ftp://example.com/hooks", "javascript:alert(1)", "not-a-url", "", "   "])(
    "rejects %j",
    (url) => {
      expect(() => assertValidWebhookUrl(url)).toThrow(WebhookUrlError);
    },
  );

  test("rejects URLs longer than 2048 characters", () => {
    expect(() => assertValidWebhookUrl(`https://example.com/${"a".repeat(2100)}`)).toThrow(
      WebhookUrlError,
    );
  });
});

describe("normalizeEventTypes", () => {
  test("undefined and empty arrays mean all event types", () => {
    expect(normalizeEventTypes(undefined)).toEqual([]);
    expect(normalizeEventTypes([])).toEqual([]);
  });

  test("passes through known event types and dedupes", () => {
    expect(normalizeEventTypes(["member.invited", "member.invited", "api_key.created"])).toEqual([
      "member.invited",
      "api_key.created",
    ]);
  });

  test("throws WebhookEventTypeError for an unknown type", () => {
    expect(() => normalizeEventTypes(["member.invited", "bogus.event"])).toThrow(
      WebhookEventTypeError,
    );
  });
});

describe("redactSensitiveKeys", () => {
  test("strips nested sensitive keys and keeps innocuous keys", () => {
    const redacted = redactSensitiveKeys({
      eventId: "evt-1",
      data: {
        apiKey: "ak_123",
        api_key: "ak_456",
        "api-key": "ak_789",
        Authorization: "Bearer abc",
        password: "hunter2",
        userSecret: "s3cret",
        refreshToken: "tok",
        name: "Acme Inc",
        nested: { token: "x", pinned: true, count: 3 },
      },
    });

    expect(redacted).toEqual({
      eventId: "evt-1",
      data: {
        apiKey: "[redacted]",
        api_key: "[redacted]",
        "api-key": "[redacted]",
        Authorization: "[redacted]",
        password: "[redacted]",
        userSecret: "[redacted]",
        refreshToken: "[redacted]",
        name: "Acme Inc",
        nested: { token: "[redacted]", pinned: true, count: 3 },
      },
    });
  });

  test("redacts array entries recursively and keeps array length stable", () => {
    const redacted = redactSensitiveKeys({ items: [{ token: "t" }, { id: 1 }] });
    expect(redacted).toEqual({ items: [{ token: "[redacted]" }, { id: 1 }] });
  });

  test("keeps non-object values untouched", () => {
    expect(redactSensitiveKeys({ value: 42, flag: true, nothing: null })).toEqual({
      value: 42,
      flag: true,
      nothing: null,
    });
  });
});

describe("endpointSubscribesTo", () => {
  test("an empty subscription list matches every event type", () => {
    expect(endpointSubscribesTo(makeWebhookEndpoint({ events: [] }), "member.invited")).toBe(true);
  });

  test("matches only listed event types otherwise", () => {
    const endpoint = makeWebhookEndpoint({ events: ["member.invited", "api_key.created"] });
    expect(endpointSubscribesTo(endpoint, "member.invited")).toBe(true);
    expect(endpointSubscribesTo(endpoint, "api_key.created")).toBe(true);
    expect(endpointSubscribesTo(endpoint, "organization.created")).toBe(false);
  });
});

describe("createWebhookSecret", () => {
  test("produces a unique base64url secret of 43 characters", () => {
    const secrets = new Set(Array.from({ length: 32 }, () => createWebhookSecret()));
    expect(secrets.size).toBe(32);
    for (const secret of secrets) {
      expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    }
  });
});

describe("registerWebhookUseCase", () => {
  const org = makeOrganization();

  function setup(role: "owner" | "admin" | "auditor" | "member" = "owner") {
    const repos = createFakeRepositories();
    repos.organizationStore.set(org.id, org);
    repos.membershipStore.set("membership-1", makeMembership({ userId: "user-1", role }));
    const { audit, records } = createFakeAudit();
    const useCase = registerWebhookUseCase({
      organizations: repos.organizations,
      memberships: repos.memberships,
      webhooks: repos.webhooks,
      audit: createOrganizationAudit(audit),
    });
    return { repos, useCase, records };
  }

  test("registers an endpoint with a generated secret and records webhook.registered audit", async () => {
    const { repos, useCase, records } = setup();

    const { endpoint, secret } = await useCase({
      actorUserId: "user-1",
      organizationId: org.id,
      url: "https://example.com/hooks",
      events: ["member.invited"],
    });

    expect(endpoint).toMatchObject({
      organizationId: org.id,
      url: "https://example.com/hooks",
      events: ["member.invited"],
      active: true,
    });
    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(repos.webhookEndpointStore.get(endpoint.id)?.secret).toBe(secret);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      actorUserId: "user-1",
      action: "webhook.registered",
      resourceType: "webhook_endpoint",
      resourceId: org.id,
      outcome: "success",
      metadata: { url: "https://example.com/hooks", events: ["member.invited"] },
    });
    expect(JSON.stringify(records[0])).not.toContain(secret);
  });

  test("an undefined events list subscribes to all events", async () => {
    const { useCase } = setup();

    const { endpoint } = await useCase({
      actorUserId: "user-1",
      organizationId: org.id,
      url: "https://example.com/hooks",
    });

    expect(endpoint.events).toEqual([]);
  });

  test("rejects a member actor with ForbiddenOrganizationActionError", async () => {
    const { repos, useCase } = setup("member");

    await expect(
      useCase({ actorUserId: "user-1", organizationId: org.id, url: "https://example.com/hooks" }),
    ).rejects.toThrow(ForbiddenOrganizationActionError);
    expect(repos.webhookEndpointStore.size).toBe(0);
  });

  test("rejects a non-member actor with MembershipNotFoundError", async () => {
    const { repos, useCase } = setup();

    await expect(
      useCase({
        actorUserId: "stranger",
        organizationId: org.id,
        url: "https://example.com/hooks",
      }),
    ).rejects.toThrow(MembershipNotFoundError);
    expect(repos.webhookEndpointStore.size).toBe(0);
  });

  test("rejects an unknown organization with OrganizationNotFoundError", async () => {
    const { useCase } = setup();

    await expect(
      useCase({
        actorUserId: "user-1",
        organizationId: "missing",
        url: "https://example.com/hooks",
      }),
    ).rejects.toThrow(OrganizationNotFoundError);
  });

  test("rejects a suspended organization with OrganizationSuspendedError", async () => {
    const { repos, useCase } = setup();
    repos.organizationStore.set(org.id, makeOrganization({ status: "suspended" }));

    await expect(
      useCase({ actorUserId: "user-1", organizationId: org.id, url: "https://example.com/hooks" }),
    ).rejects.toThrow(OrganizationSuspendedError);
  });

  test("rejects an invalid URL before creating anything", async () => {
    const { repos, useCase } = setup();

    await expect(
      useCase({ actorUserId: "user-1", organizationId: org.id, url: "ftp://example.com" }),
    ).rejects.toThrow(WebhookUrlError);
    expect(repos.webhookEndpointStore.size).toBe(0);
  });

  test("rejects an invalid event type before creating anything", async () => {
    const { repos, useCase } = setup();

    await expect(
      useCase({
        actorUserId: "user-1",
        organizationId: org.id,
        url: "https://example.com/hooks",
        events: ["not.a.real.event"],
      }),
    ).rejects.toThrow(WebhookEventTypeError);
    expect(repos.webhookEndpointStore.size).toBe(0);
  });
});

describe("rotateWebhookSecretUseCase", () => {
  const org = makeOrganization();
  const endpoint = makeWebhookEndpoint({ secret: "old-secret" });

  function setup(role: "owner" | "admin" | "member" = "owner") {
    const repos = createFakeRepositories();
    repos.organizationStore.set(org.id, org);
    repos.membershipStore.set("membership-1", makeMembership({ userId: "user-1", role }));
    repos.webhookEndpointStore.set(endpoint.id, endpoint);
    const { audit, records } = createFakeAudit();
    const useCase = rotateWebhookSecretUseCase({
      organizations: repos.organizations,
      memberships: repos.memberships,
      webhooks: repos.webhooks,
      audit: createOrganizationAudit(audit),
    });
    return { repos, useCase, records };
  }

  test("rotates to a new secret and records webhook.secret_rotated", async () => {
    const { repos, useCase, records } = setup();

    const { endpoint: rotated, secret } = await useCase({
      actorUserId: "user-1",
      organizationId: org.id,
      webhookId: endpoint.id,
    });

    expect(secret).not.toBe("old-secret");
    expect(rotated.secret).toBe(secret);
    expect(repos.webhookEndpointStore.get(endpoint.id)?.secret).toBe(secret);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      actorUserId: "user-1",
      action: "webhook.secret_rotated",
      resourceType: "webhook_endpoint",
      outcome: "success",
    });
    expect(JSON.stringify(records[0])).not.toContain(secret);
  });

  test("rejects a member actor with ForbiddenOrganizationActionError", async () => {
    const { repos, useCase } = setup("member");

    await expect(
      useCase({ actorUserId: "user-1", organizationId: org.id, webhookId: endpoint.id }),
    ).rejects.toThrow(ForbiddenOrganizationActionError);
    expect(repos.webhookEndpointStore.get(endpoint.id)?.secret).toBe("old-secret");
  });

  test("throws WebhookEndpointNotFoundError for an unknown or other-organization endpoint", async () => {
    const { repos, useCase } = setup();
    repos.webhookEndpointStore.set(
      "webhook-other",
      makeWebhookEndpoint({ id: "webhook-other", organizationId: "org-2" }),
    );

    await expect(
      useCase({ actorUserId: "user-1", organizationId: org.id, webhookId: "missing" }),
    ).rejects.toThrow(WebhookEndpointNotFoundError);
    await expect(
      useCase({ actorUserId: "user-1", organizationId: org.id, webhookId: "webhook-other" }),
    ).rejects.toThrow(WebhookEndpointNotFoundError);
  });
});

describe("listWebhooksUseCase", () => {
  const org = makeOrganization();

  test("returns endpoints without secrets for any active member", async () => {
    const repos = createFakeRepositories();
    repos.organizationStore.set(org.id, org);
    repos.membershipStore.set("membership-1", makeMembership({ userId: "user-1", role: "member" }));
    repos.webhookEndpointStore.set(
      "webhook-1",
      makeWebhookEndpoint({ id: "webhook-1", secret: "super-secret" }),
    );
    const useCase = listWebhooksUseCase({
      organizations: repos.organizations,
      memberships: repos.memberships,
      webhooks: repos.webhooks,
    });

    const endpoints = await useCase({ actorUserId: "user-1", organizationId: org.id });

    expect(endpoints).toHaveLength(1);
    expect(endpoints[0]).toMatchObject({
      id: "webhook-1",
      organizationId: org.id,
      url: "https://example.com/hooks",
    });
    expect(endpoints[0]).not.toHaveProperty("secret");
    expect(JSON.stringify(endpoints)).not.toContain("super-secret");
  });

  test("rejects a non-member actor with MembershipNotFoundError", async () => {
    const repos = createFakeRepositories();
    repos.organizationStore.set(org.id, org);
    const useCase = listWebhooksUseCase({
      organizations: repos.organizations,
      memberships: repos.memberships,
      webhooks: repos.webhooks,
    });

    await expect(useCase({ actorUserId: "stranger", organizationId: org.id })).rejects.toThrow(
      MembershipNotFoundError,
    );
  });
});

describe("toggleWebhookUseCase", () => {
  const org = makeOrganization();
  const endpoint = makeWebhookEndpoint();

  function setup(role: "owner" | "member" = "owner") {
    const repos = createFakeRepositories();
    repos.organizationStore.set(org.id, org);
    repos.membershipStore.set("membership-1", makeMembership({ userId: "user-1", role }));
    repos.webhookEndpointStore.set(endpoint.id, endpoint);
    const useCase = toggleWebhookUseCase({
      organizations: repos.organizations,
      memberships: repos.memberships,
      webhooks: repos.webhooks,
    });
    return { repos, useCase };
  }

  test("deactivates and reactivates an endpoint", async () => {
    const { repos, useCase } = setup();

    const deactivated = await useCase({
      actorUserId: "user-1",
      organizationId: org.id,
      webhookId: endpoint.id,
      active: false,
    });
    expect(deactivated.active).toBe(false);
    expect(repos.webhookEndpointStore.get(endpoint.id)?.active).toBe(false);

    const reactivated = await useCase({
      actorUserId: "user-1",
      organizationId: org.id,
      webhookId: endpoint.id,
      active: true,
    });
    expect(reactivated.active).toBe(true);
  });

  test("rejects a member actor with ForbiddenOrganizationActionError", async () => {
    const { repos, useCase } = setup("member");

    await expect(
      useCase({
        actorUserId: "user-1",
        organizationId: org.id,
        webhookId: endpoint.id,
        active: false,
      }),
    ).rejects.toThrow(ForbiddenOrganizationActionError);
    expect(repos.webhookEndpointStore.get(endpoint.id)?.active).toBe(true);
  });

  test("throws WebhookEndpointNotFoundError for an unknown endpoint", async () => {
    const { useCase } = setup();

    await expect(
      useCase({
        actorUserId: "user-1",
        organizationId: org.id,
        webhookId: "missing",
        active: false,
      }),
    ).rejects.toThrow(WebhookEndpointNotFoundError);
  });
});

describe("createWebhookDeliverer", () => {
  interface DeliverCall {
    url: string;
    secret: string;
    payload: Record<string, unknown>;
    headers: Record<string, string>;
  }

  function setup(
    deliver: (input: DeliverCall) => Promise<{ status: number }> | { status: number },
  ) {
    const repos = createFakeRepositories();
    const delivered: DeliverCall[] = [];
    const deliverer = createWebhookDeliverer({
      webhooks: repos.webhooks,
      now: () => FIXED_NOW,
      deliver: async (input) => {
        delivered.push(input);
        return deliver(input);
      },
    });
    return { repos, deliverer, delivered };
  }

  function setupWithMetrics(
    deliver: (input: DeliverCall) => Promise<{ status: number }> | { status: number },
  ) {
    const counters: Record<string, number> = {};
    const metrics = {
      incrementCounter: (name: string, value = 1) => {
        counters[name] = (counters[name] ?? 0) + value;
      },
    };
    const repos = createFakeRepositories();
    const deliverer = createWebhookDeliverer({
      webhooks: repos.webhooks,
      now: () => FIXED_NOW,
      deliver: async (input) => deliver(input),
      metrics,
    });
    return { repos, deliverer, counters };
  }

  const endpoint = makeWebhookEndpoint({ secret: "signing-secret" });
  const event = makeEvent({
    payload: { apiKey: "ak_123", name: "Acme Inc" },
  });

  test("2xx: marks the delivery succeeded with the status code and signed headers", async () => {
    const { repos, deliverer, delivered } = setup(() => ({ status: 200 }));

    const result = await deliverer.deliverWebhook(endpoint, event);

    expect(result.status).toBe("succeeded");
    expect(result.lastStatusCode).toBe(200);
    expect(repos.webhookDeliveryStore.get(result.id)?.status).toBe("succeeded");

    expect(delivered).toHaveLength(1);
    const call = delivered[0] as DeliverCall;
    expect(call.url).toBe(endpoint.url);
    expect(call.headers["x-webhook-event-id"]).toBe(event.id);
    expect(call.headers["x-webhook-event-type"]).toBe("organization.created");
    expect(call.headers["x-webhook-timestamp"]).toBe(
      String(Math.floor(FIXED_NOW.getTime() / 1000)),
    );
    expect(call.headers["content-type"]).toBe("application/json");
    expect(call.headers["idempotency-key"]).toBe(event.id);

    // Signature format: sha256=<HMAC-SHA256(secret, timestamp + "." + JSON.stringify(payload))>
    const signature = call.headers["x-webhook-signature"];
    expect(signature).toMatch(/^sha256=[0-9a-f]{64}$/);
    const expected = createHmac("sha256", endpoint.secret)
      .update(`${call.headers["x-webhook-timestamp"]}.${JSON.stringify(call.payload)}`)
      .digest("hex");
    expect(signature).toBe(`sha256=${expected}`);

    // Payload envelope with the sensitive event data redacted.
    expect(call.payload).toEqual({
      eventId: event.id,
      type: "organization.created",
      organizationId: "org-1",
      occurredAt: event.occurredAt.toISOString(),
      data: { apiKey: "[redacted]", name: "Acme Inc" },
    });
  });

  test("500: marks the delivery failed with attempts +1 and a backoff nextAttemptAt", async () => {
    const { repos, deliverer, delivered } = setup(() => ({ status: 500 }));

    const result = await deliverer.deliverWebhook(endpoint, event);

    expect(result.status).toBe("failed");
    expect(result.attempts).toBe(1);
    expect(result.lastStatusCode).toBe(500);
    expect(result.lastError).toContain("HTTP 500");
    expect(result.nextAttemptAt.getTime()).toBe(FIXED_NOW.getTime() + 1_000);
    expect(repos.webhookDeliveryStore.get(result.id)?.status).toBe("failed");
    expect(delivered).toHaveLength(1);
  });

  test("network error: marks the delivery failed with null status code and a backoff", async () => {
    const { repos, deliverer, delivered } = setup(() => {
      throw new Error("fetch failed");
    });

    const result = await deliverer.deliverWebhook(endpoint, event);

    expect(result.status).toBe("failed");
    expect(result.attempts).toBe(1);
    expect(result.lastStatusCode).toBeNull();
    expect(result.lastError).toContain("fetch failed");
    expect(result.nextAttemptAt.getTime()).toBe(FIXED_NOW.getTime() + 1_000);
    expect(repos.webhookDeliveryStore.get(result.id)?.status).toBe("failed");
    expect(delivered).toHaveLength(1);
  });

  test("deliveries never throw on HTTP or network failures", async () => {
    const { deliverer } = setup(() => {
      throw new Error("boom");
    });
    await expect(deliverer.deliverWebhook(endpoint, event)).resolves.toMatchObject({
      status: "failed",
    });
  });

  test("2xx increments webhook delivery success counters when metrics are provided", async () => {
    const { deliverer, counters } = setupWithMetrics(() => ({ status: 200 }));

    const result = await deliverer.deliverWebhook(endpoint, event);

    expect(result.status).toBe("succeeded");
    expect(counters).toEqual({
      webhook_deliveries_total: 1,
      webhook_deliveries_succeeded_total: 1,
    });
  });

  test("HTTP failure increments webhook delivery failure counters", async () => {
    const { deliverer, counters } = setupWithMetrics(() => ({ status: 500 }));

    const result = await deliverer.deliverWebhook(endpoint, event);

    expect(result.status).toBe("failed");
    expect(counters).toEqual({
      webhook_deliveries_total: 1,
      webhook_deliveries_failed_total: 1,
    });
  });

  test("throws WebhookNotActiveError for an inactive endpoint", async () => {
    const { deliverer, delivered } = setup(() => ({ status: 200 }));

    await expect(deliverer.deliverWebhook({ ...endpoint, active: false }, event)).rejects.toThrow(
      WebhookNotActiveError,
    );
    expect(delivered).toHaveLength(0);
  });
});

describe("computeWebhookNextAttemptAt", () => {
  test("backoff doubles per attempt and caps at 1 hour", () => {
    expect(computeWebhookNextAttemptAt(0, FIXED_NOW).getTime()).toBe(FIXED_NOW.getTime() + 1_000);
    expect(computeWebhookNextAttemptAt(1, FIXED_NOW).getTime()).toBe(FIXED_NOW.getTime() + 2_000);
    expect(computeWebhookNextAttemptAt(2, FIXED_NOW).getTime()).toBe(FIXED_NOW.getTime() + 4_000);
    expect(computeWebhookNextAttemptAt(12, FIXED_NOW).getTime()).toBe(
      FIXED_NOW.getTime() + 60 * 60 * 1_000,
    );
    expect(computeWebhookNextAttemptAt(20, FIXED_NOW).getTime()).toBe(
      FIXED_NOW.getTime() + 60 * 60 * 1_000,
    );
  });
});

describe("createWebhookOutboxHandler", () => {
  const endpointAll = makeWebhookEndpoint({ id: "webhook-all", events: [] });
  const endpointScoped = makeWebhookEndpoint({
    id: "webhook-scoped",
    events: ["member.invited"],
  });
  const endpointInactive = makeWebhookEndpoint({
    id: "webhook-inactive",
    events: [],
    active: false,
  });
  const endpointOtherOrg = makeWebhookEndpoint({
    id: "webhook-other",
    organizationId: "org-2",
    events: [],
  });

  function setup(deliver: (endpoint: WebhookEndpoint) => Promise<WebhookDelivery>) {
    const repos = createFakeRepositories();
    repos.webhookEndpointStore.set(endpointAll.id, endpointAll);
    repos.webhookEndpointStore.set(endpointScoped.id, endpointScoped);
    repos.webhookEndpointStore.set(endpointInactive.id, endpointInactive);
    repos.webhookEndpointStore.set(endpointOtherOrg.id, endpointOtherOrg);
    const deliveredTo: string[] = [];
    const handlers = createWebhookOutboxHandler({
      webhooks: repos.webhooks,
      deliverer: {
        deliverWebhook: async (endpoint: WebhookEndpoint) => {
          deliveredTo.push(endpoint.id);
          return deliver(endpoint);
        },
      },
    });
    return { repos, handlers, deliveredTo };
  }

  test("registers a handler for every event type", () => {
    const { handlers } = setup(async () => makeWebhookDelivery());
    expect(Object.keys(handlers).sort()).toEqual([
      "api_key.created",
      "api_key.revoked",
      "invitation.accepted",
      "member.invited",
      "member.removed",
      "organization.created",
      "organization.deleted",
      "organization.suspended",
      "ownership.transferred",
    ]);
  });

  test("delivers only to active subscribed endpoints of the event's organization", async () => {
    const { handlers, deliveredTo } = setup(async () => makeWebhookDelivery());

    await handlers["member.invited"]?.(makeEvent({ type: "member.invited" }));

    expect(deliveredTo.sort()).toEqual(["webhook-all", "webhook-scoped"]);
  });

  test("an endpoint subscribed to specific types is skipped for other types", async () => {
    const { handlers, deliveredTo } = setup(async () => makeWebhookDelivery());

    await handlers["api_key.created"]?.(makeEvent({ type: "api_key.created" }));

    expect(deliveredTo.sort()).toEqual(["webhook-all"]);
  });

  test("resolves without throwing when a delivery fails", async () => {
    const { handlers } = setup(async () => {
      throw new Error("delivery exploded");
    });

    await expect(
      handlers["organization.created"]?.(makeEvent({ type: "organization.created" })),
    ).resolves.toBeUndefined();
  });

  test("resolves when there are no endpoints", async () => {
    const { repos, handlers, deliveredTo } = setup(async () => makeWebhookDelivery());
    repos.webhookEndpointStore.clear();

    await handlers["organization.created"]?.(makeEvent({ type: "organization.created" }));

    expect(deliveredTo).toEqual([]);
  });
});
