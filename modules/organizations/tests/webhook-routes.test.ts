import { describe, expect, test } from "bun:test";
import type { Config } from "@consulting/config";
import type { Context } from "hono";

import { createApp } from "../../../apps/api/src/app";
import {
  createFakeRepositories,
  type FakeRepositories,
  makeMembership,
  makeOrganization,
  makeWebhookDelivery,
  makeWebhookEndpoint,
} from "./fakes";

const config: Config = {
  APP_ENV: "test",
  APP_VERSION: "0.1.0",
  API_BASE_URL: "http://localhost:3000",
  LOG_LEVEL: "debug",
  PORT: 3000,
  HOST: "0.0.0.0",
  CORS_ORIGINS: ["https://app.example.com"],
  DATABASE_URL: "postgres://postgres:postgres@localhost:5432/api",
  BETTER_AUTH_SECRET: "test-secret-at-least-32-characters-long",
  TRUSTED_ORIGINS: [],
};

const OWNER = { id: "user-1", email: "owner@example.com" };
const ADMIN = { id: "user-3", email: "admin@example.com" };
const MEMBER = { id: "user-2", email: "member@example.com" };
const SESSION_COOKIE = "better-auth.session_token=fake-token";
const ORG_HEADER = "x-organization-id";

type StubAuth = NonNullable<NonNullable<Parameters<typeof createApp>[1]>["auth"]>;

function stubAuth(user: { id: string; email: string } | null): StubAuth {
  const stub = {
    handler: async () => new Response(null, { status: 404 }),
    sessionMiddleware: async (
      c: Context<{ Variables: { user: { id: string; email: string } | null; session: unknown } }>,
      next: () => Promise<void>,
    ) => {
      const hasCredentials = (c.req.header("cookie") ?? "").includes("better-auth.session_token");
      c.set("user", hasCredentials ? user : null);
      c.set("session", null);
      await next();
    },
    getSession: async () => null,
    close: async () => {},
  };
  return stub as unknown as StubAuth;
}

function appWithAuth(auth: StubAuth, repos: FakeRepositories) {
  return createApp(config, {
    auth,
    organizations: {
      repositories: {
        organizations: repos.organizations,
        memberships: repos.memberships,
        invitations: repos.invitations,
        apiKeys: repos.apiKeys,
        webhooks: repos.webhooks,
        uow: null,
      },
    },
  });
}

function setup(): FakeRepositories {
  const repos = createFakeRepositories();
  repos.organizationStore.set("org-1", makeOrganization({ id: "org-1", slug: "acme-inc" }));
  repos.membershipStore.set(
    "membership-1",
    makeMembership({ id: "membership-1", userId: OWNER.id, role: "owner" }),
  );
  repos.membershipStore.set(
    "membership-3",
    makeMembership({ id: "membership-3", userId: ADMIN.id, role: "admin" }),
  );
  repos.membershipStore.set(
    "membership-2",
    makeMembership({ id: "membership-2", userId: MEMBER.id, role: "member" }),
  );
  repos.webhookEndpointStore.set(
    "webhook-1",
    makeWebhookEndpoint({ id: "webhook-1", secret: "stored-signing-secret" }),
  );
  return repos;
}

async function problem(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

function jsonRequest(options: { method?: string; cookie?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.cookie !== undefined) {
    headers.cookie = options.cookie;
  }
  return {
    method: options.method ?? "POST",
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  };
}

function orgRequest(
  organizationId: string,
  options: { method?: string; cookie?: string; body?: unknown } = {},
) {
  const request = jsonRequest(options);
  return {
    ...request,
    headers: { ...request.headers, [ORG_HEADER]: organizationId },
  };
}

describe("POST /api/v1/organizations/:id/webhooks", () => {
  test("registers an endpoint with 201 and returns the secret exactly once", async () => {
    const repos = setup();
    const app = appWithAuth(stubAuth(OWNER), repos);

    const res = await app.request(
      "/api/v1/organizations/org-1/webhooks",
      orgRequest("org-1", {
        cookie: SESSION_COOKIE,
        body: { url: "https://example.com/hooks", events: ["member.invited"] },
      }),
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.endpoint).toMatchObject({
      organizationId: "org-1",
      url: "https://example.com/hooks",
      events: ["member.invited"],
      active: true,
    });
    // The endpoint shape never exposes the signing secret; the secret is only
    // in the one-time top-level field.
    expect(body.endpoint.secret).toBeUndefined();
    expect(body.endpoint.keyHash).toBeUndefined();
    expect(body.secret).toBeString();
    expect(body.secret).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const stored = repos.webhookEndpointStore.get(body.endpoint.id as string);
    expect(stored?.secret).toBe(body.secret);
  });

  test("an admin actor can register a webhook", async () => {
    const repos = setup();
    const app = appWithAuth(stubAuth(ADMIN), repos);

    const res = await app.request(
      "/api/v1/organizations/org-1/webhooks",
      orgRequest("org-1", {
        cookie: SESSION_COOKIE,
        body: { url: "https://example.com/hooks" },
      }),
    );

    expect(res.status).toBe(201);
  });

  test("returns 403 for a member actor", async () => {
    const repos = setup();
    const app = appWithAuth(stubAuth(MEMBER), repos);

    const res = await app.request(
      "/api/v1/organizations/org-1/webhooks",
      orgRequest("org-1", {
        cookie: SESSION_COOKIE,
        body: { url: "https://example.com/hooks" },
      }),
    );

    expect(res.status).toBe(403);
    expect(await problem(res)).toMatchObject({ status: 403, code: "FORBIDDEN" });
    expect(repos.webhookEndpointStore.size).toBe(1);
  });

  test("returns 400 for an invalid URL", async () => {
    const repos = setup();
    const app = appWithAuth(stubAuth(OWNER), repos);

    const res = await app.request(
      "/api/v1/organizations/org-1/webhooks",
      orgRequest("org-1", { cookie: SESSION_COOKIE, body: { url: "ftp://example.com" } }),
    );

    expect(res.status).toBe(400);
    expect(await problem(res)).toMatchObject({ status: 400 });
    expect(repos.webhookEndpointStore.size).toBe(1);
  });

  test("returns 400 for an invalid event type", async () => {
    const repos = setup();
    const app = appWithAuth(stubAuth(OWNER), repos);

    const res = await app.request(
      "/api/v1/organizations/org-1/webhooks",
      orgRequest("org-1", {
        cookie: SESSION_COOKIE,
        body: { url: "https://example.com/hooks", events: ["not.a.real.event"] },
      }),
    );

    expect(res.status).toBe(400);
    expect(repos.webhookEndpointStore.size).toBe(1);
  });

  test("returns 401 without a session", async () => {
    const repos = setup();
    const app = appWithAuth(stubAuth(null), repos);

    const res = await app.request(
      "/api/v1/organizations/org-1/webhooks",
      orgRequest("org-1", { body: { url: "https://example.com/hooks" } }),
    );

    expect(res.status).toBe(401);
  });
});

describe("GET /api/v1/organizations/:id/webhooks", () => {
  test("lists endpoints without secrets", async () => {
    const repos = setup();
    const app = appWithAuth(stubAuth(OWNER), repos);

    const res = await app.request(
      "/api/v1/organizations/org-1/webhooks",
      orgRequest("org-1", { method: "GET", cookie: SESSION_COOKIE }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>[];
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ id: "webhook-1", url: "https://example.com/hooks" });
    expect(body[0]).not.toHaveProperty("secret");
    expect(JSON.stringify(body)).not.toContain("stored-signing-secret");
  });

  test("a member actor can list webhooks", async () => {
    const repos = setup();
    const app = appWithAuth(stubAuth(MEMBER), repos);

    const res = await app.request(
      "/api/v1/organizations/org-1/webhooks",
      orgRequest("org-1", { method: "GET", cookie: SESSION_COOKIE }),
    );

    expect(res.status).toBe(200);
  });
});

describe("POST /api/v1/organizations/:id/webhooks/:webhookId/rotate", () => {
  test("rotates the secret and returns it exactly once", async () => {
    const repos = setup();
    const app = appWithAuth(stubAuth(OWNER), repos);

    const res = await app.request(
      "/api/v1/organizations/org-1/webhooks/webhook-1/rotate",
      orgRequest("org-1", { cookie: SESSION_COOKIE }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.secret).toBeString();
    expect(body.secret).not.toBe("stored-signing-secret");
    expect(body.endpoint).toMatchObject({ id: "webhook-1", url: "https://example.com/hooks" });
    expect(body.endpoint.secret).toBeUndefined();
    expect(repos.webhookEndpointStore.get("webhook-1")?.secret).toBe(body.secret);
  });

  test("returns 403 for a member actor", async () => {
    const repos = setup();
    const app = appWithAuth(stubAuth(MEMBER), repos);

    const res = await app.request(
      "/api/v1/organizations/org-1/webhooks/webhook-1/rotate",
      orgRequest("org-1", { cookie: SESSION_COOKIE }),
    );

    expect(res.status).toBe(403);
    expect(repos.webhookEndpointStore.get("webhook-1")?.secret).toBe("stored-signing-secret");
  });

  test("returns 404 for an unknown endpoint", async () => {
    const repos = setup();
    const app = appWithAuth(stubAuth(OWNER), repos);

    const res = await app.request(
      "/api/v1/organizations/org-1/webhooks/unknown/rotate",
      orgRequest("org-1", { cookie: SESSION_COOKIE }),
    );

    expect(res.status).toBe(404);
    expect(await problem(res)).toMatchObject({ status: 404, code: "NOT_FOUND" });
  });
});

describe("POST /api/v1/organizations/:id/webhooks/:webhookId/toggle", () => {
  test("deactivates and reactivates an endpoint", async () => {
    const repos = setup();
    const app = appWithAuth(stubAuth(OWNER), repos);

    const off = await app.request(
      "/api/v1/organizations/org-1/webhooks/webhook-1/toggle",
      orgRequest("org-1", { cookie: SESSION_COOKIE, body: { active: false } }),
    );
    expect(off.status).toBe(200);
    expect((await off.json()).active).toBe(false);
    expect(repos.webhookEndpointStore.get("webhook-1")?.active).toBe(false);

    const on = await app.request(
      "/api/v1/organizations/org-1/webhooks/webhook-1/toggle",
      orgRequest("org-1", { cookie: SESSION_COOKIE, body: { active: true } }),
    );
    expect(on.status).toBe(200);
    expect((await on.json()).active).toBe(true);
  });

  test("returns 403 for a member actor", async () => {
    const repos = setup();
    const app = appWithAuth(stubAuth(MEMBER), repos);

    const res = await app.request(
      "/api/v1/organizations/org-1/webhooks/webhook-1/toggle",
      orgRequest("org-1", { cookie: SESSION_COOKIE, body: { active: false } }),
    );

    expect(res.status).toBe(403);
    expect(repos.webhookEndpointStore.get("webhook-1")?.active).toBe(true);
  });

  test("returns 404 for an unknown endpoint", async () => {
    const repos = setup();
    const app = appWithAuth(stubAuth(OWNER), repos);

    const res = await app.request(
      "/api/v1/organizations/org-1/webhooks/unknown/toggle",
      orgRequest("org-1", { cookie: SESSION_COOKIE, body: { active: false } }),
    );

    expect(res.status).toBe(404);
  });
});

describe("GET /api/v1/organizations/:id/webhooks/:webhookId/deliveries", () => {
  test("lists the delivery history with a limit", async () => {
    const repos = setup();
    repos.webhookDeliveryStore.set(
      "delivery-1",
      makeWebhookDelivery({
        id: "delivery-1",
        endpointId: "webhook-1",
        eventId: "event-1",
        status: "succeeded",
        attempts: 2,
        lastStatusCode: 200,
      }),
    );
    const app = appWithAuth(stubAuth(OWNER), repos);

    const res = await app.request(
      "/api/v1/organizations/org-1/webhooks/webhook-1/deliveries?limit=5",
      orgRequest("org-1", { method: "GET", cookie: SESSION_COOKIE }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>[];
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({
      endpointId: "webhook-1",
      eventId: "event-1",
      status: "succeeded",
      attempts: 2,
      lastStatusCode: 200,
    });
  });

  test("returns 404 for an unknown endpoint", async () => {
    const repos = setup();
    const app = appWithAuth(stubAuth(OWNER), repos);

    const res = await app.request(
      "/api/v1/organizations/org-1/webhooks/unknown/deliveries",
      orgRequest("org-1", { method: "GET", cookie: SESSION_COOKIE }),
    );

    expect(res.status).toBe(404);
  });

  test("returns 400 for an invalid limit", async () => {
    const repos = setup();
    const app = appWithAuth(stubAuth(OWNER), repos);

    const res = await app.request(
      "/api/v1/organizations/org-1/webhooks/webhook-1/deliveries?limit=0",
      orgRequest("org-1", { method: "GET", cookie: SESSION_COOKIE }),
    );

    expect(res.status).toBe(400);
  });
});
