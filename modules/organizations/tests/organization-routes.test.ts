import { describe, expect, test } from "bun:test";
import type { AuditLogger } from "@consulting/audit";
import type { Config } from "@consulting/config";
import type { Context } from "hono";

import { createApp } from "../../../apps/api/src/app";
import { hashInvitationToken } from "../src/application/token";
import {
  createFakeAudit,
  createFakeRepositories,
  type FakeRepositories,
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
  // Stub replaces the DB-bound createAuth: the session middleware always
  // resolves the fixed fake user (or null) so no database is involved.
  const stub = {
    handler: async () => new Response(null, { status: 404 }),
    sessionMiddleware: async (
      c: Context<{ Variables: { user: { id: string; email: string } | null; session: unknown } }>,
      next: () => Promise<void>,
    ) => {
      // Mirrors the real session middleware: the user resolves only when the
      // request carries a session cookie.
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

type TestContext = {
  app: ReturnType<typeof createApp>;
  repos: FakeRepositories;
};

function appWithAuth(auth: StubAuth, repos: FakeRepositories, audit?: AuditLogger) {
  return createApp(config, {
    auth,
    organizations: {
      repositories: {
        organizations: repos.organizations,
        memberships: repos.memberships,
        invitations: repos.invitations,
        apiKeys: repos.apiKeys,
        uow: null,
      },
      ...(audit === undefined ? {} : { audit }),
    },
  });
}

function setup(user: { id: string; email: string } = OWNER): TestContext {
  const repos = createFakeRepositories();
  const org = makeOrganization({ id: "org-1", slug: "acme-inc" });
  repos.organizationStore.set(org.id, org);
  repos.membershipStore.set(
    "membership-1",
    makeMembership({ id: "membership-1", userId: OWNER.id, role: "owner" }),
  );
  const app = appWithAuth(stubAuth(user), repos);
  return { app, repos };
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

describe("POST /api/v1/organizations", () => {
  test("creates an organization owned by the session user with 201", async () => {
    const repos = createFakeRepositories();
    const app = appWithAuth(stubAuth(OWNER), repos);

    const res = await app.request(
      "/api/v1/organizations",
      jsonRequest({
        cookie: SESSION_COOKIE,
        body: { name: "Acme Inc", slug: "acme-inc" },
      }),
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ name: "Acme Inc", slug: "acme-inc", status: "active" });
    expect(body.id).toBeString();
    expect(body.createdAt).toBeString();
    expect(repos.membershipStore.size).toBe(1);
    expect([...repos.membershipStore.values()][0]).toMatchObject({
      organizationId: body.id,
      userId: "user-1",
      role: "owner",
      status: "active",
    });
  });

  test("rejects an invalid body with 400 VALIDATION_FAILED", async () => {
    const repos = createFakeRepositories();
    const app = appWithAuth(stubAuth(OWNER), repos);

    const res = await app.request(
      "/api/v1/organizations",
      jsonRequest({
        cookie: SESSION_COOKIE,
        body: { name: "   ", slug: "Acme_Inc!" },
      }),
    );

    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
    const body = await problem(res);
    expect(body).toMatchObject({ status: 400, code: "VALIDATION_FAILED" });
    expect(body.errors).toBeInstanceOf(Array);
  });

  test("rejects a duplicate slug with 409 CONFLICT", async () => {
    const { app } = setup();
    const res = await app.request(
      "/api/v1/organizations",
      jsonRequest({
        cookie: SESSION_COOKIE,
        body: { name: "Other Inc", slug: "acme-inc" },
      }),
    );

    expect(res.status).toBe(409);
    expect(await problem(res)).toMatchObject({ status: 409, code: "CONFLICT", title: "Conflict" });
  });

  test("rejects with 401 UNAUTHORIZED when there is no session", async () => {
    const { app } = setup();
    const res = await app.request(
      "/api/v1/organizations",
      jsonRequest({ body: { name: "Acme", slug: "acme" } }),
    );

    expect(res.status).toBe(401);
    expect(await problem(res)).toMatchObject({ status: 401, code: "UNAUTHORIZED" });
  });
});

describe("GET /api/v1/organizations/:id", () => {
  test("returns the caller's tenant context with 200", async () => {
    const { app } = setup();

    const res = await app.request(
      "/api/v1/organizations/org-1",
      orgRequest("org-1", { method: "GET", cookie: SESSION_COOKIE }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      organizationId: "org-1",
      membershipId: "membership-1",
      userId: "user-1",
      roleIds: ["owner"],
    });
  });

  test("rejects with 401 UNAUTHORIZED when there is no session", async () => {
    const { app } = setup();

    const res = await app.request(
      "/api/v1/organizations/org-1",
      orgRequest("org-1", { method: "GET" }),
    );

    expect(res.status).toBe(401);
    expect(await problem(res)).toMatchObject({ status: 401, code: "UNAUTHORIZED" });
  });

  test("rejects with 400 VALIDATION_FAILED when the organization header is missing", async () => {
    const { app } = setup();

    const res = await app.request("/api/v1/organizations/org-1", {
      method: "GET",
      headers: { cookie: SESSION_COOKIE },
    });

    expect(res.status).toBe(400);
    expect(await problem(res)).toMatchObject({ status: 400, code: "VALIDATION_FAILED" });
  });

  test("rejects an unknown organization with 404 NOT_FOUND", async () => {
    const { app } = setup();

    const res = await app.request(
      "/api/v1/organizations/missing",
      orgRequest("missing-org", {
        method: "GET",
        cookie: SESSION_COOKIE,
      }),
    );

    expect(res.status).toBe(404);
    expect(await problem(res)).toMatchObject({ status: 404, code: "NOT_FOUND" });
  });

  test("rejects a non-member with 403 FORBIDDEN", async () => {
    const repos = createFakeRepositories();
    repos.organizationStore.set("org-1", makeOrganization({ id: "org-1", slug: "acme-inc" }));
    const app = appWithAuth(stubAuth(MEMBER), repos);

    const res = await app.request(
      "/api/v1/organizations/org-1",
      orgRequest("org-1", {
        method: "GET",
        cookie: SESSION_COOKIE,
      }),
    );

    expect(res.status).toBe(403);
    expect(await problem(res)).toMatchObject({ status: 403, code: "FORBIDDEN" });
  });

  test("rejects access to a suspended organization with 403 FORBIDDEN", async () => {
    const repos = createFakeRepositories();
    repos.organizationStore.set(
      "org-1",
      makeOrganization({ id: "org-1", slug: "acme-inc", status: "suspended" }),
    );
    repos.membershipStore.set(
      "membership-1",
      makeMembership({ id: "membership-1", userId: OWNER.id, role: "owner" }),
    );
    const app = appWithAuth(stubAuth(OWNER), repos);

    const res = await app.request(
      "/api/v1/organizations/org-1",
      orgRequest("org-1", {
        method: "GET",
        cookie: SESSION_COOKIE,
      }),
    );

    expect(res.status).toBe(403);
    expect(await problem(res)).toMatchObject({ status: 403, code: "FORBIDDEN" });
  });
});

describe("POST /api/v1/organizations/:id/invitations", () => {
  test("creates an invitation and returns the raw one-time token with 201", async () => {
    const { app, repos } = setup();

    const res = await app.request(
      "/api/v1/organizations/org-1/invitations",
      orgRequest("org-1", {
        cookie: SESSION_COOKIE,
        body: { email: "invitee@example.com", role: "member" },
      }),
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.token).toBeString();
    expect(body.token.length).toBe(64);
    expect(body.invitation).toMatchObject({
      organizationId: "org-1",
      email: "invitee@example.com",
      role: "member",
    });
    expect(body.invitation.tokenHash).toBeUndefined();
    expect(repos.invitationStore.size).toBe(1);
    const stored = [...repos.invitationStore.values()][0];
    expect(stored?.tokenHash).toBe(hashInvitationToken(body.token as string));
  });

  test("rejects a non-admin member with 403 FORBIDDEN", async () => {
    const { app, repos } = setup(MEMBER);
    repos.membershipStore.set(
      "membership-2",
      makeMembership({ id: "membership-2", userId: MEMBER.id, role: "member" }),
    );

    const res = await app.request(
      "/api/v1/organizations/org-1/invitations",
      orgRequest("org-1", {
        cookie: SESSION_COOKIE,
        body: { email: "invitee@example.com", role: "member" },
      }),
    );

    expect(res.status).toBe(403);
    expect(await problem(res)).toMatchObject({ status: 403, code: "FORBIDDEN" });
    expect(repos.invitationStore.size).toBe(0);
  });

  test("rejects inviting the owner role with 400 VALIDATION_FAILED", async () => {
    const { app } = setup();

    const res = await app.request(
      "/api/v1/organizations/org-1/invitations",
      orgRequest("org-1", {
        cookie: SESSION_COOKIE,
        body: { email: "invitee@example.com", role: "owner" },
      }),
    );

    expect(res.status).toBe(400);
    expect(await problem(res)).toMatchObject({ status: 400, code: "VALIDATION_FAILED" });
  });
});

describe("POST /api/v1/organizations/accept-invitation", () => {
  async function seedInvitation(repos: FakeRepositories, expiresAt: Date) {
    const token = "a".repeat(64);
    await repos.invitations.create({
      organizationId: "org-1",
      email: "invitee@example.com",
      role: "member",
      tokenHash: hashInvitationToken(token),
      expiresAt,
    });
    return token;
  }

  function acceptApp(repos: FakeRepositories) {
    return appWithAuth(stubAuth(MEMBER), repos);
  }

  test("accepts the invitation and returns the membership with 200", async () => {
    const repos = createFakeRepositories();
    repos.organizationStore.set("org-1", makeOrganization({ id: "org-1", slug: "acme-inc" }));
    const token = await seedInvitation(repos, new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
    const app = acceptApp(repos);

    const res = await app.request(
      "/api/v1/organizations/accept-invitation",
      jsonRequest({
        cookie: SESSION_COOKIE,
        body: { token },
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      organizationId: "org-1",
      userId: "user-2",
      role: "member",
      status: "active",
    });
    expect([...repos.invitationStore.values()][0]?.usedAt).toBeInstanceOf(Date);
  });

  test("rejects an unknown token with 404 NOT_FOUND", async () => {
    const repos = createFakeRepositories();
    repos.organizationStore.set("org-1", makeOrganization({ id: "org-1", slug: "acme-inc" }));
    const app = acceptApp(repos);

    const res = await app.request(
      "/api/v1/organizations/accept-invitation",
      jsonRequest({
        cookie: SESSION_COOKIE,
        body: { token: "b".repeat(64) },
      }),
    );

    expect(res.status).toBe(404);
    expect(await problem(res)).toMatchObject({ status: 404, code: "NOT_FOUND" });
  });

  test("rejects an expired invitation with 400 VALIDATION_FAILED", async () => {
    const repos = createFakeRepositories();
    repos.organizationStore.set("org-1", makeOrganization({ id: "org-1", slug: "acme-inc" }));
    const token = await seedInvitation(repos, new Date(Date.now() - 1000));
    const app = acceptApp(repos);

    const res = await app.request(
      "/api/v1/organizations/accept-invitation",
      jsonRequest({
        cookie: SESSION_COOKIE,
        body: { token },
      }),
    );

    expect(res.status).toBe(400);
    expect(await problem(res)).toMatchObject({ status: 400, code: "VALIDATION_FAILED" });
  });
});

describe("POST /api/v1/organizations/:id/ownership", () => {
  function setupWithTarget(user: { id: string; email: string } = OWNER): TestContext {
    const { app, repos } = setup(user);
    repos.membershipStore.set(
      "membership-2",
      makeMembership({
        id: "membership-2",
        organizationId: "org-1",
        userId: MEMBER.id,
        role: "member",
      }),
    );
    return { app, repos };
  }

  test("transfers ownership and demotes the previous owner with 200", async () => {
    const { app, repos } = setupWithTarget();

    const res = await app.request(
      "/api/v1/organizations/org-1/ownership",
      orgRequest("org-1", {
        cookie: SESSION_COOKIE,
        body: { newOwnerUserId: "user-2" },
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.previousOwner).toMatchObject({ userId: "user-1", role: "admin" });
    expect(body.newOwner).toMatchObject({ userId: "user-2", role: "owner" });
    expect(repos.membershipStore.get("membership-1")?.role).toBe("admin");
    expect(repos.membershipStore.get("membership-2")?.role).toBe("owner");
  });

  test("rejects a non-owner actor with 403 FORBIDDEN", async () => {
    const { app } = setupWithTarget(MEMBER);

    const res = await app.request(
      "/api/v1/organizations/org-1/ownership",
      orgRequest("org-1", {
        cookie: SESSION_COOKIE,
        body: { newOwnerUserId: "user-1" },
      }),
    );

    expect(res.status).toBe(403);
    expect(await problem(res)).toMatchObject({ status: 403, code: "FORBIDDEN" });
  });

  test("rejects transferring ownership to a stranger with 403 FORBIDDEN", async () => {
    const { app } = setupWithTarget();

    const res = await app.request(
      "/api/v1/organizations/org-1/ownership",
      orgRequest("org-1", {
        cookie: SESSION_COOKIE,
        body: { newOwnerUserId: "stranger" },
      }),
    );

    expect(res.status).toBe(403);
    expect(await problem(res)).toMatchObject({ status: 403, code: "FORBIDDEN" });
  });

  test("rejects transferring ownership to the actor with 400 VALIDATION_FAILED", async () => {
    const { app } = setupWithTarget();

    const res = await app.request(
      "/api/v1/organizations/org-1/ownership",
      orgRequest("org-1", {
        cookie: SESSION_COOKIE,
        body: { newOwnerUserId: "user-1" },
      }),
    );

    expect(res.status).toBe(400);
    expect(await problem(res)).toMatchObject({ status: 400, code: "VALIDATION_FAILED" });
  });
});

describe("POST /api/v1/organizations/:id/suspend", () => {
  test("suspends the organization with 200", async () => {
    const { app, repos } = setup();

    const res = await app.request(
      "/api/v1/organizations/org-1/suspend",
      orgRequest("org-1", {
        cookie: SESSION_COOKIE,
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ id: "org-1", status: "suspended" });
    expect(repos.organizationStore.get("org-1")?.status).toBe("suspended");
  });

  test("rejects a non-owner actor with 403 FORBIDDEN", async () => {
    const { app, repos } = setup(MEMBER);
    repos.membershipStore.set(
      "membership-2",
      makeMembership({ id: "membership-2", userId: MEMBER.id, role: "member" }),
    );

    const res = await app.request(
      "/api/v1/organizations/org-1/suspend",
      orgRequest("org-1", {
        cookie: SESSION_COOKIE,
      }),
    );

    expect(res.status).toBe(403);
    expect(await problem(res)).toMatchObject({ status: 403, code: "FORBIDDEN" });
  });
});

describe("DELETE /api/v1/organizations/:id/members/:userId", () => {
  test("removes a member with 204", async () => {
    const { app, repos } = setup();
    repos.membershipStore.set(
      "membership-2",
      makeMembership({ id: "membership-2", userId: MEMBER.id, role: "member" }),
    );

    const res = await app.request(
      "/api/v1/organizations/org-1/members/user-2",
      orgRequest("org-1", { method: "DELETE", cookie: SESSION_COOKIE }),
    );

    expect(res.status).toBe(204);
    expect(repos.membershipStore.has("membership-2")).toBe(false);
  });

  test("rejects removing the last owner with 400 VALIDATION_FAILED", async () => {
    const { app } = setup();

    const res = await app.request(
      "/api/v1/organizations/org-1/members/user-1",
      orgRequest("org-1", { method: "DELETE", cookie: SESSION_COOKIE }),
    );

    expect(res.status).toBe(400);
    expect(await problem(res)).toMatchObject({ status: 400, code: "VALIDATION_FAILED" });
  });

  test("rejects a non-owner removing another member with 403 FORBIDDEN", async () => {
    const { app, repos } = setup(MEMBER);
    repos.membershipStore.set(
      "membership-2",
      makeMembership({ id: "membership-2", userId: MEMBER.id, role: "member" }),
    );
    repos.membershipStore.set(
      "membership-3",
      makeMembership({ id: "membership-3", userId: "user-3", role: "member" }),
    );

    const res = await app.request(
      "/api/v1/organizations/org-1/members/user-3",
      orgRequest("org-1", { method: "DELETE", cookie: SESSION_COOKIE }),
    );

    expect(res.status).toBe(403);
    expect(await problem(res)).toMatchObject({ status: 403, code: "FORBIDDEN" });
  });
});

describe("DELETE /api/v1/organizations/:id", () => {
  test("deletes the organization after confirmation with 204", async () => {
    const { app, repos } = setup();

    const res = await app.request(
      "/api/v1/organizations/org-1?confirm=true",
      orgRequest("org-1", { method: "DELETE", cookie: SESSION_COOKIE }),
    );

    expect(res.status).toBe(204);
    expect(repos.organizationStore.has("org-1")).toBe(false);
  });

  test("rejects deletion without confirmation with 400 VALIDATION_FAILED", async () => {
    const { app, repos } = setup();

    const res = await app.request(
      "/api/v1/organizations/org-1?confirm=false",
      orgRequest("org-1", { method: "DELETE", cookie: SESSION_COOKIE }),
    );

    expect(res.status).toBe(400);
    expect(await problem(res)).toMatchObject({ status: 400, code: "VALIDATION_FAILED" });
    expect(repos.organizationStore.has("org-1")).toBe(true);
  });

  test("rejects a non-owner deleting with 403 FORBIDDEN", async () => {
    const { app, repos } = setup(MEMBER);
    repos.membershipStore.set(
      "membership-2",
      makeMembership({ id: "membership-2", userId: MEMBER.id, role: "member" }),
    );

    const res = await app.request(
      "/api/v1/organizations/org-1?confirm=true",
      orgRequest("org-1", { method: "DELETE", cookie: SESSION_COOKIE }),
    );

    expect(res.status).toBe(403);
    expect(await problem(res)).toMatchObject({ status: 403, code: "FORBIDDEN" });
  });
});

describe("audit logging", () => {
  test("records organization.created when an organization is created", async () => {
    const repos = createFakeRepositories();
    const { audit, records } = createFakeAudit();
    const app = appWithAuth(stubAuth(OWNER), repos, audit);

    const res = await app.request(
      "/api/v1/organizations",
      jsonRequest({
        cookie: SESSION_COOKIE,
        body: { name: "Acme Inc", slug: "acme-inc" },
      }),
    );

    expect(res.status).toBe(201);
    expect(records).toContainEqual({
      actorUserId: "user-1",
      action: "organization.created",
      resourceType: "organization",
      resourceId: "org-1",
      outcome: "success",
    });
  });

  test("records organization.suspended when an organization is suspended", async () => {
    const repos = createFakeRepositories();
    repos.organizationStore.set("org-1", makeOrganization({ id: "org-1", slug: "acme-inc" }));
    repos.membershipStore.set(
      "membership-1",
      makeMembership({ id: "membership-1", userId: OWNER.id, role: "owner" }),
    );
    const { audit, records } = createFakeAudit();
    const app = appWithAuth(stubAuth(OWNER), repos, audit);

    const res = await app.request(
      "/api/v1/organizations/org-1/suspend",
      orgRequest("org-1", {
        cookie: SESSION_COOKIE,
      }),
    );

    expect(res.status).toBe(200);
    expect(records).toContainEqual({
      actorUserId: "user-1",
      action: "organization.suspended",
      resourceType: "organization",
      resourceId: "org-1",
      outcome: "success",
    });
  });

  test("records member.invited when a member is invited", async () => {
    const repos = createFakeRepositories();
    repos.organizationStore.set("org-1", makeOrganization({ id: "org-1", slug: "acme-inc" }));
    repos.membershipStore.set(
      "membership-1",
      makeMembership({ id: "membership-1", userId: OWNER.id, role: "owner" }),
    );
    const { audit, records } = createFakeAudit();
    const app = appWithAuth(stubAuth(OWNER), repos, audit);

    const res = await app.request(
      "/api/v1/organizations/org-1/invitations",
      orgRequest("org-1", {
        cookie: SESSION_COOKIE,
        body: { email: "invitee@example.com", role: "member" },
      }),
    );

    expect(res.status).toBe(201);
    expect(records).toContainEqual({
      actorUserId: "user-1",
      action: "member.invited",
      resourceType: "organization",
      resourceId: "org-1",
      outcome: "success",
      metadata: { email: "invitee@example.com" },
    });
  });

  test("records invitation.accepted when an invitation is accepted", async () => {
    const repos = createFakeRepositories();
    repos.organizationStore.set("org-1", makeOrganization({ id: "org-1", slug: "acme-inc" }));
    await repos.invitations.create({
      organizationId: "org-1",
      email: "invitee@example.com",
      role: "member",
      tokenHash: hashInvitationToken("a".repeat(64)),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });
    const { audit, records } = createFakeAudit();
    const app = appWithAuth(stubAuth(MEMBER), repos, audit);

    const res = await app.request(
      "/api/v1/organizations/accept-invitation",
      jsonRequest({ cookie: SESSION_COOKIE, body: { token: "a".repeat(64) } }),
    );

    expect(res.status).toBe(200);
    expect(records).toContainEqual({
      actorUserId: "user-2",
      action: "invitation.accepted",
      resourceType: "organization",
      resourceId: "org-1",
      outcome: "success",
      metadata: { email: "invitee@example.com" },
    });
  });

  test("records ownership.transferred when ownership changes hands", async () => {
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
    const { audit, records } = createFakeAudit();
    const app = appWithAuth(stubAuth(OWNER), repos, audit);

    const res = await app.request(
      "/api/v1/organizations/org-1/ownership",
      orgRequest("org-1", {
        cookie: SESSION_COOKIE,
        body: { newOwnerUserId: "user-2" },
      }),
    );

    expect(res.status).toBe(200);
    expect(records).toContainEqual({
      actorUserId: "user-1",
      action: "ownership.transferred",
      resourceType: "organization",
      resourceId: "org-1",
      outcome: "success",
      metadata: { previousOwnerUserId: "user-1", newOwnerUserId: "user-2" },
    });
  });

  test("records member.removed when a member is removed", async () => {
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
    const { audit, records } = createFakeAudit();
    const app = appWithAuth(stubAuth(OWNER), repos, audit);

    const res = await app.request(
      "/api/v1/organizations/org-1/members/user-2",
      orgRequest("org-1", { method: "DELETE", cookie: SESSION_COOKIE }),
    );

    expect(res.status).toBe(204);
    expect(records).toContainEqual({
      actorUserId: "user-1",
      action: "member.removed",
      resourceType: "organization",
      resourceId: "org-1",
      outcome: "success",
      metadata: { targetUserId: "user-2" },
    });
  });

  test("records organization.deleted when an organization is deleted", async () => {
    const repos = createFakeRepositories();
    repos.organizationStore.set("org-1", makeOrganization({ id: "org-1", slug: "acme-inc" }));
    repos.membershipStore.set(
      "membership-1",
      makeMembership({ id: "membership-1", userId: OWNER.id, role: "owner" }),
    );
    const { audit, records } = createFakeAudit();
    const app = appWithAuth(stubAuth(OWNER), repos, audit);

    const res = await app.request(
      "/api/v1/organizations/org-1?confirm=true",
      orgRequest("org-1", { method: "DELETE", cookie: SESSION_COOKIE }),
    );

    expect(res.status).toBe(204);
    expect(records).toContainEqual({
      actorUserId: "user-1",
      action: "organization.deleted",
      resourceType: "organization",
      resourceId: "org-1",
      outcome: "success",
    });
  });

  test("keeps working when audit is not provided", async () => {
    const { app } = setup();

    const res = await app.request(
      "/api/v1/organizations/org-1/suspend",
      orgRequest("org-1", {
        cookie: SESSION_COOKIE,
      }),
    );

    expect(res.status).toBe(200);
  });
});
