import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type AuditLogger, createAuditDb, createAuditLogger } from "@consulting/audit";
import { type Auth, createAuth } from "@consulting/auth";
import type { Config } from "@consulting/config";
import {
  createApiKeyRepository,
  createDb,
  createInvitationRepository,
  createMembershipRepository,
  createOrganizationRepository,
  createWebhookRepository,
} from "@consulting/module-organizations";

import {
  closeClient,
  createTestClient,
  getDatabaseUrl,
  migrateToLatest,
  resetDatabase,
} from "../../../modules/notes/tests/db-test-utils";
import { createApp } from "../src/app";

const databaseUrl = getDatabaseUrl();
const describeDb = databaseUrl === null ? describe.skip : describe;
if (databaseUrl === null) {
  console.warn("[tenancy tests] DATABASE_URL is not set — skipping real-DB tests");
}

const PASSWORD = "password-123456";
const TEST_TIMEOUT_MS = 30_000;

type TestApp = ReturnType<typeof createApp>;

let app: TestApp | undefined;
let sequence = 0;

function requireApp(): TestApp {
  if (app === undefined) {
    throw new Error("tenancy test app was not initialized");
  }
  return app;
}

function uniqueEmail(prefix: string): string {
  sequence += 1;
  return `${prefix}-${Date.now()}-${sequence}@example.com`;
}

function uniqueSlug(prefix: string): string {
  sequence += 1;
  return `${prefix}-${Date.now()}-${sequence}`;
}

function jsonHeaders(extra?: Record<string, string>): Headers {
  return new Headers({ "content-type": "application/json", ...extra });
}

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

function sessionCookie(setCookie: string | null): string {
  const match = setCookie?.match(/better-auth\.session_token=[^;]+/);
  expect(match, "Better Auth did not set a session cookie").not.toBeNull();
  return match?.[0] ?? "";
}

async function signUp(email: string): Promise<Response> {
  return requireApp().request("/api/auth/sign-up/email", {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ name: "Tenancy Test User", email, password: PASSWORD }),
  });
}

async function signIn(email: string): Promise<string> {
  const response = await requireApp().request("/api/auth/sign-in/email", {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  expect(response.status).toBe(200);
  return sessionCookie(response.headers.get("set-cookie"));
}

function organizationRequest(options: {
  method?: string;
  cookie?: string;
  organizationId?: string;
  body?: unknown;
}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.cookie !== undefined) {
    headers.cookie = options.cookie;
  }
  if (options.organizationId !== undefined) {
    headers["x-organization-id"] = options.organizationId;
  }
  return {
    method: options.method ?? "POST",
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  };
}

describeDb("organization HTTP API (real database)", () => {
  const client = createTestClient(databaseUrl as string);
  const config: Config = {
    APP_ENV: "test",
    APP_VERSION: "0.1.0",
    API_BASE_URL: "http://localhost:3000",
    LOG_LEVEL: "debug",
    PORT: 3000,
    HOST: "0.0.0.0",
    CORS_ORIGINS: ["https://app.example.com"],
    DATABASE_URL: databaseUrl as string,
    BETTER_AUTH_SECRET: "test-secret-at-least-32-characters-long",
    TRUSTED_ORIGINS: [],
  };
  let auth: Auth | undefined;
  let auditLogger: AuditLogger | undefined;

  beforeAll(async () => {
    await resetDatabase(client);
    await migrateToLatest(client);

    const db = createDb(client);
    auditLogger = createAuditLogger(createAuditDb(client));
    const createdAuth = createAuth({
      secret: config.BETTER_AUTH_SECRET,
      baseURL: config.BETTER_AUTH_URL ?? config.API_BASE_URL,
      trustedOrigins: [...config.TRUSTED_ORIGINS, new URL(config.API_BASE_URL).origin],
      databaseUrl: config.DATABASE_URL,
    });
    auth = createdAuth;
    app = createApp(config, {
      auth: createdAuth,
      organizations: {
        repositories: {
          organizations: createOrganizationRepository(db),
          memberships: createMembershipRepository(db),
          invitations: createInvitationRepository(db),
          apiKeys: createApiKeyRepository(db),
          webhooks: createWebhookRepository(db),
          uow: null,
        },
        audit: auditLogger,
      },
    });
  });

  afterAll(async () => {
    try {
      if (auth !== undefined) {
        await auth.close();
      }
    } finally {
      await closeClient(client);
      app = undefined;
    }
  });

  test(
    "runs the full organization lifecycle: create, context, invite, accept, transfer, suspend",
    async () => {
      const ownerEmail = uniqueEmail("owner");
      const memberEmail = uniqueEmail("member");
      expect((await signUp(ownerEmail)).status).toBe(200);
      expect((await signUp(memberEmail)).status).toBe(200);
      const ownerCookie = await signIn(ownerEmail);
      const memberCookie = await signIn(memberEmail);

      const createResponse = await requireApp().request(
        "/api/v1/organizations",
        organizationRequest({
          cookie: ownerCookie,
          body: { name: "Acme Inc", slug: uniqueSlug("acme") },
        }),
      );
      expect(createResponse.status).toBe(201);
      const created = await readJson<{ id: string; status: string }>(createResponse);
      expect(created.id).toBeString();
      expect(created.status).toBe("active");
      const organizationId = created.id;

      const contextResponse = await requireApp().request(
        `/api/v1/organizations/${organizationId}`,
        organizationRequest({
          method: "GET",
          cookie: ownerCookie,
          organizationId,
        }),
      );
      expect(contextResponse.status).toBe(200);
      expect(await readJson<Record<string, unknown>>(contextResponse)).toEqual({
        organizationId,
        membershipId: expect.any(String),
        userId: expect.any(String),
        roleIds: ["owner"],
      });

      const strangerResponse = await requireApp().request(
        `/api/v1/organizations/${organizationId}`,
        organizationRequest({
          method: "GET",
          cookie: memberCookie,
          organizationId,
        }),
      );
      expect(strangerResponse.status).toBe(403);
      expect(await readJson<{ code: string }>(strangerResponse)).toMatchObject({
        code: "FORBIDDEN",
      });

      const inviteResponse = await requireApp().request(
        `/api/v1/organizations/${organizationId}/invitations`,
        organizationRequest({
          cookie: ownerCookie,
          organizationId,
          body: { email: memberEmail, role: "member" },
        }),
      );
      expect(inviteResponse.status).toBe(201);
      const invited = await readJson<{ token: string; invitation: { role: string } }>(
        inviteResponse,
      );
      expect(invited.token.length).toBe(64);
      expect(invited.invitation.role).toBe("member");

      const acceptResponse = await requireApp().request(
        "/api/v1/organizations/accept-invitation",
        organizationRequest({
          cookie: memberCookie,
          body: { token: invited.token },
        }),
      );
      expect(acceptResponse.status).toBe(200);
      const membership = await readJson<{
        organizationId: string;
        role: string;
        userId: string;
      }>(acceptResponse);
      expect(membership).toMatchObject({ organizationId, role: "member" });

      const memberInviteResponse = await requireApp().request(
        `/api/v1/organizations/${organizationId}/invitations`,
        organizationRequest({
          cookie: memberCookie,
          organizationId,
          body: { email: uniqueEmail("extra"), role: "member" },
        }),
      );
      expect(memberInviteResponse.status).toBe(403);
      expect(await readJson<{ code: string }>(memberInviteResponse)).toMatchObject({
        code: "FORBIDDEN",
      });

      const transferResponse = await requireApp().request(
        `/api/v1/organizations/${organizationId}/ownership`,
        organizationRequest({
          cookie: ownerCookie,
          organizationId,
          body: { newOwnerUserId: membership.userId },
        }),
      );
      expect(transferResponse.status).toBe(200);
      const transferred = await readJson<{
        previousOwner: { role: string };
        newOwner: { role: string };
      }>(transferResponse);
      expect(transferred.previousOwner.role).toBe("admin");
      expect(transferred.newOwner.role).toBe("owner");

      const suspendResponse = await requireApp().request(
        `/api/v1/organizations/${organizationId}/suspend`,
        organizationRequest({
          cookie: memberCookie,
          organizationId,
        }),
      );
      expect(suspendResponse.status).toBe(200);
      expect(await readJson<{ status: string }>(suspendResponse)).toMatchObject({
        status: "suspended",
      });

      const suspendedAccessResponse = await requireApp().request(
        `/api/v1/organizations/${organizationId}`,
        organizationRequest({
          method: "GET",
          cookie: ownerCookie,
          organizationId,
        }),
      );
      expect(suspendedAccessResponse.status).toBe(403);
      expect(await readJson<{ code: string }>(suspendedAccessResponse)).toMatchObject({
        code: "FORBIDDEN",
      });

      const auditEntries = (await auditLogger?.list()) ?? [];
      const orgAuditEntries = auditEntries.filter(
        (entry) => entry.resourceType === "organization" && entry.resourceId === organizationId,
      );
      expect(orgAuditEntries.some((entry) => entry.action === "organization.created")).toBe(true);
      expect(orgAuditEntries.some((entry) => entry.action === "member.invited")).toBe(true);
      expect(
        orgAuditEntries
          .filter((entry) => entry.action === "member.invited")
          .every((entry) => entry.actorUserId !== null),
      ).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );
});
