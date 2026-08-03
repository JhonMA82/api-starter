import { describe, expect, test } from "bun:test";
import type { Config } from "@consulting/config";
import type { Context } from "hono";
import { Hono } from "hono";

import { createApp } from "../../../apps/api/src/app";
import { hashApiKeySecret } from "../src/application/api-key-token";
import { verifyApiKeyUseCase } from "../src/application/verify-api-key";
import {
  type ApiKeyMiddlewareVariables,
  createApiKeyMiddleware,
} from "../src/http/api-key-middleware";
import {
  createFakeApiKeyRepository,
  createFakeRepositories,
  type FakeRepositories,
  makeApiKey,
  makeMembership,
  makeOrganization,
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
    "membership-2",
    makeMembership({ id: "membership-2", userId: MEMBER.id, role: "member" }),
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

describe("POST /api/v1/organizations/:id/api-keys", () => {
  test("creates an api key with 201 and returns the secret exactly once", async () => {
    const repos = setup();
    const app = appWithAuth(stubAuth(OWNER), repos);

    const res = await app.request(
      "/api/v1/organizations/org-1/api-keys",
      orgRequest("org-1", { cookie: SESSION_COOKIE, body: { name: "CI deploy key" } }),
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.apiKey).toMatchObject({ name: "CI deploy key", organizationId: "org-1" });
    expect(body.apiKey.prefix).toBeString();
    expect(body.apiKey.keyHash).toBeUndefined();
    expect(body.secret).toBeString();
    expect(body.secret.length).toBeGreaterThanOrEqual(32);

    const stored = [...repos.apiKeyStore.values()][0];
    if (stored === undefined) {
      throw new Error("api key was not stored");
    }
    expect(stored.keyHash).toBe(hashApiKeySecret(body.secret));
    expect(stored.name).toBe("CI deploy key");
    expect(stored.prefix).toBe(body.secret.slice(0, 8));
    expect(body.secret).not.toContain(stored.keyHash);
  });

  test("honors an optional expiresAt", async () => {
    const repos = setup();
    const app = appWithAuth(stubAuth(OWNER), repos);

    const res = await app.request(
      "/api/v1/organizations/org-1/api-keys",
      orgRequest("org-1", {
        cookie: SESSION_COOKIE,
        body: { name: "short-lived", expiresAt: "2099-01-01T00:00:00.000Z" },
      }),
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.apiKey.expiresAt).toBe("2099-01-01T00:00:00.000Z");
  });

  test("returns 403 for a member actor", async () => {
    const repos = setup();
    const app = appWithAuth(stubAuth(MEMBER), repos);

    const res = await app.request(
      "/api/v1/organizations/org-1/api-keys",
      orgRequest("org-1", { cookie: SESSION_COOKIE, body: { name: "CI deploy key" } }),
    );

    expect(res.status).toBe(403);
    expect(await problem(res)).toMatchObject({ status: 403, code: "FORBIDDEN" });
    expect(repos.apiKeyStore.size).toBe(0);
  });

  test("returns 400 for a blank name", async () => {
    const repos = setup();
    const app = appWithAuth(stubAuth(OWNER), repos);

    const res = await app.request(
      "/api/v1/organizations/org-1/api-keys",
      orgRequest("org-1", { cookie: SESSION_COOKIE, body: { name: "   " } }),
    );

    expect(res.status).toBe(400);
    expect(await problem(res)).toMatchObject({ status: 400, code: "VALIDATION_FAILED" });
    expect(repos.apiKeyStore.size).toBe(0);
  });

  test("returns 401 without a session", async () => {
    const repos = setup();
    const app = appWithAuth(stubAuth(null), repos);

    const res = await app.request(
      "/api/v1/organizations/org-1/api-keys",
      orgRequest("org-1", { body: { name: "CI deploy key" } }),
    );

    expect(res.status).toBe(401);
  });
});

describe("DELETE /api/v1/organizations/:id/api-keys/:keyId", () => {
  test("revokes the key with 204", async () => {
    const repos = setup();
    repos.apiKeyStore.set("api-key-1", makeApiKey({ id: "api-key-1" }));
    const app = appWithAuth(stubAuth(OWNER), repos);

    const res = await app.request(
      "/api/v1/organizations/org-1/api-keys/api-key-1",
      orgRequest("org-1", { method: "DELETE", cookie: SESSION_COOKIE }),
    );

    expect(res.status).toBe(204);
    expect(repos.apiKeyStore.get("api-key-1")?.revokedAt).not.toBeNull();
  });

  test("returns 403 for a member actor", async () => {
    const repos = setup();
    repos.apiKeyStore.set("api-key-1", makeApiKey({ id: "api-key-1" }));
    const app = appWithAuth(stubAuth(MEMBER), repos);

    const res = await app.request(
      "/api/v1/organizations/org-1/api-keys/api-key-1",
      orgRequest("org-1", { method: "DELETE", cookie: SESSION_COOKIE }),
    );

    expect(res.status).toBe(403);
    expect(repos.apiKeyStore.get("api-key-1")?.revokedAt).toBeNull();
  });

  test("returns 404 for an unknown key", async () => {
    const repos = setup();
    const app = appWithAuth(stubAuth(OWNER), repos);

    const res = await app.request(
      "/api/v1/organizations/org-1/api-keys/unknown-key",
      orgRequest("org-1", { method: "DELETE", cookie: SESSION_COOKIE }),
    );

    expect(res.status).toBe(404);
    expect(await problem(res)).toMatchObject({ status: 404, code: "NOT_FOUND" });
  });

  test("returns 404 for a key that belongs to another organization", async () => {
    const repos = setup();
    repos.apiKeyStore.set(
      "api-key-other",
      makeApiKey({ id: "api-key-other", organizationId: "org-2" }),
    );
    const app = appWithAuth(stubAuth(OWNER), repos);

    const res = await app.request(
      "/api/v1/organizations/org-1/api-keys/api-key-other",
      orgRequest("org-1", { method: "DELETE", cookie: SESSION_COOKIE }),
    );

    expect(res.status).toBe(404);
    expect(repos.apiKeyStore.get("api-key-other")?.revokedAt).toBeNull();
  });
});

describe("createApiKeyMiddleware", () => {
  const SECRET = "valid-api-key-secret";

  function buildApp() {
    const { apiKeys, apiKeyStore } = createFakeApiKeyRepository();
    apiKeyStore.set(
      "api-key-1",
      makeApiKey({ id: "api-key-1", keyHash: hashApiKeySecret(SECRET) }),
    );
    const verifyApiKey = verifyApiKeyUseCase({ apiKeys });
    const app = new Hono<{ Variables: ApiKeyMiddlewareVariables }>();
    app.use("*", createApiKeyMiddleware({ verifyApiKey }));
    app.get("/protected", (c) => c.json({ apiKey: c.get("apiKey") }));
    return app;
  }

  test("resolves a valid bearer token and sets apiKey", async () => {
    const app = buildApp();

    const res = await app.request("/protected", {
      headers: { authorization: `Bearer ${SECRET}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.apiKey).toMatchObject({ id: "api-key-1", organizationId: "org-1" });
  });

  test("passes through when there is no Authorization header", async () => {
    const app = buildApp();

    const res = await app.request("/protected");

    expect(res.status).toBe(200);
    expect((await res.json()).apiKey).toBeNull();
  });

  test("returns 401 for an invalid bearer token", async () => {
    const app = buildApp();

    const res = await app.request("/protected", {
      headers: { authorization: "Bearer wrong-secret" },
    });

    expect(res.status).toBe(401);
  });

  test("returns 401 for an expired bearer token", async () => {
    const { apiKeys, apiKeyStore } = createFakeApiKeyRepository();
    apiKeyStore.set(
      "api-key-expired",
      makeApiKey({
        id: "api-key-expired",
        keyHash: hashApiKeySecret(SECRET),
        expiresAt: new Date("2026-01-01T00:00:00Z"),
      }),
    );
    const verifyApiKey = verifyApiKeyUseCase({ apiKeys });
    const app2 = new Hono<{ Variables: ApiKeyMiddlewareVariables }>();
    app2.use("*", createApiKeyMiddleware({ verifyApiKey }));
    app2.get("/protected", (c) => c.json({ apiKey: c.get("apiKey") }));

    const res = await app2.request("/protected", {
      headers: { authorization: `Bearer ${SECRET}` },
    });

    expect(res.status).toBe(401);
  });

  test("skips verification when a session cookie is present (session takes precedence)", async () => {
    const app = buildApp();

    const res = await app.request("/protected", {
      headers: {
        authorization: `Bearer ${SECRET}`,
        cookie: SESSION_COOKIE,
      },
    });

    expect(res.status).toBe(200);
    expect((await res.json()).apiKey).toBeNull();
  });

  test("passes through non-bearer authorization schemes", async () => {
    const app = buildApp();

    const res = await app.request("/protected", {
      headers: { authorization: "Basic dXNlcjpwYXNz" },
    });

    expect(res.status).toBe(200);
    expect((await res.json()).apiKey).toBeNull();
  });
});
