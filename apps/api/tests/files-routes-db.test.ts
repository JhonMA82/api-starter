import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type Auth, createAuth } from "@consulting/auth";
import type { Config } from "@consulting/config";
import {
  createApiKeyRepository,
  createInvitationRepository,
  createMembershipRepository,
  createOrganizationRepository,
  createDb as createOrganizationsDb,
  createWebhookRepository,
} from "@consulting/module-organizations";
import {
  createDb,
  createFileRepository,
  createLocalFileStorage,
  createSha256Hasher,
  createSignedDownloadToken,
} from "../../../modules/files/src";
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
  console.warn("[file routes db tests] DATABASE_URL is not set — skipping real-DB tests");
}

const PASSWORD = "password-123456";
const TEST_TIMEOUT_MS = 30_000;
const SIGNED_URL_SECRET = "test-file-routes-db-secret";
const BASE_URL = "http://localhost:3000";

type TestApp = ReturnType<typeof createApp>;

let app: TestApp | undefined;
let sequence = 0;

function requireApp(): TestApp {
  if (app === undefined) {
    throw new Error("file routes db test app was not initialized");
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

async function signUp(email: string): Promise<void> {
  const response = await requireApp().request("/api/auth/sign-up/email", {
    method: "POST",
    headers: new Headers({ "content-type": "application/json" }),
    body: JSON.stringify({ name: "Files Test User", email, password: PASSWORD }),
  });
  expect(response.status).toBe(200);
}

async function signIn(email: string): Promise<string> {
  const response = await requireApp().request("/api/auth/sign-in/email", {
    method: "POST",
    headers: new Headers({ "content-type": "application/json" }),
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  expect(response.status).toBe(200);
  const match = response.headers.get("set-cookie")?.match(/better-auth\.session_token=[^;]+/);
  expect(match, "Better Auth did not set a session cookie").not.toBeNull();
  return match?.[0] ?? "";
}

async function createOrganization(cookie: string, name: string): Promise<string> {
  const response = await requireApp().request("/api/v1/organizations", {
    method: "POST",
    headers: new Headers({ "content-type": "application/json", cookie }),
    body: JSON.stringify({ name, slug: uniqueSlug("files") }),
  });
  expect(response.status).toBe(201);
  const body = (await response.json()) as { id: string };
  return body.id;
}

function fileHeaders(cookie: string, organizationId: string): Headers {
  return new Headers({ cookie, "x-organization-id": organizationId });
}

async function uploadFile(
  cookie: string,
  organizationId: string,
  content: string,
): Promise<{
  file: { id: string; organizationId: string; status: string };
  downloadUrl: string;
}> {
  const form = new FormData();
  form.append("file", new File([content], "report.txt", { type: "text/plain" }));
  const response = await requireApp().request("/api/v1/files", {
    method: "POST",
    headers: fileHeaders(cookie, organizationId),
    body: form,
  });
  expect(response.status).toBe(201);
  return (await response.json()) as {
    file: { id: string; organizationId: string; status: string };
    downloadUrl: string;
  };
}

async function downloadPath(downloadUrl: string): Promise<string> {
  const url = new URL(downloadUrl);
  return url.pathname + url.search;
}

describeDb("files HTTP API with real database, local storage, and the tenancy-backed guard", () => {
  const client = createTestClient(databaseUrl as string);
  const tempDir = mkdtempSync(join(tmpdir(), "files-routes-db-"));
  const config: Config = {
    APP_ENV: "test",
    APP_VERSION: "0.1.0",
    API_BASE_URL: BASE_URL,
    LOG_LEVEL: "debug",
    PORT: 3000,
    HOST: "0.0.0.0",
    CORS_ORIGINS: ["https://app.example.com"],
    DATABASE_URL: databaseUrl as string,
    BETTER_AUTH_SECRET: "test-secret-at-least-32-characters-long",
    TRUSTED_ORIGINS: [],
  };
  let auth: Auth | undefined;

  beforeAll(async () => {
    await resetDatabase(client);
    await migrateToLatest(client);

    const db = createDb(client);
    const organizationsDb = createOrganizationsDb(client);
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
          organizations: createOrganizationRepository(organizationsDb),
          memberships: createMembershipRepository(organizationsDb),
          invitations: createInvitationRepository(organizationsDb),
          apiKeys: createApiKeyRepository(organizationsDb),
          webhooks: createWebhookRepository(organizationsDb),
          uow: null,
        },
      },
      files: {
        files: createFileRepository(db),
        storage: createLocalFileStorage(tempDir),
        hash: createSha256Hasher(),
        signedUrlSecret: SIGNED_URL_SECRET,
        baseUrl: BASE_URL,
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
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test(
    "signs up, creates an organization, uploads, and downloads the exact bytes via the signed URL",
    async () => {
      const email = uniqueEmail("owner");
      await signUp(email);
      const cookie = await signIn(email);
      const organizationId = await createOrganization(cookie, "Files Inc");

      const content = "real database file bytes";
      const { file, downloadUrl } = await uploadFile(cookie, organizationId, content);
      expect(file.organizationId).toBe(organizationId);
      expect(file.status).toBe("stored");

      const downloadRes = await requireApp().request(await downloadPath(downloadUrl), {
        method: "GET",
      });
      expect(downloadRes.status).toBe(200);
      expect(downloadRes.headers.get("content-type")).toBe("text/plain");
      expect(downloadRes.headers.get("content-disposition")).toContain(
        'attachment; filename="report.txt"',
      );
      expect(new TextDecoder().decode(await downloadRes.arrayBuffer())).toBe(content);

      const metaRes = await requireApp().request(`/api/v1/files/${file.id}`, {
        method: "GET",
        headers: fileHeaders(cookie, organizationId),
      });
      expect(metaRes.status).toBe(200);

      const urlRes = await requireApp().request(`/api/v1/files/${file.id}/url`, {
        method: "POST",
        headers: fileHeaders(cookie, organizationId),
        body: "{}",
      });
      expect(urlRes.status).toBe(200);
      const issued = (await urlRes.json()) as { downloadUrl: string; expiresIn: number };
      expect(issued.expiresIn).toBe(3600);
      const issuedRes = await requireApp().request(await downloadPath(issued.downloadUrl), {
        method: "GET",
      });
      expect(issuedRes.status).toBe(200);
      expect(new TextDecoder().decode(await issuedRes.arrayBuffer())).toBe(content);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "a stranger cannot read or download another organization's files",
    async () => {
      const ownerEmail = uniqueEmail("files-owner");
      await signUp(ownerEmail);
      const ownerCookie = await signIn(ownerEmail);
      const orgA = await createOrganization(ownerCookie, "Files Org A");
      const { file } = await uploadFile(ownerCookie, orgA, "secret of org A");

      const strangerEmail = uniqueEmail("files-stranger");
      await signUp(strangerEmail);
      const strangerCookie = await signIn(strangerEmail);
      const orgB = await createOrganization(strangerCookie, "Files Org B");

      // The stranger is a member of orgB (tenant middleware passes), but the
      // lookup is tenant-scoped by orgB, so orgA's file does not exist there:
      // IDOR-safe 404 (never a 403 leaking the file's existence).
      const metaRes = await requireApp().request(`/api/v1/files/${file.id}`, {
        method: "GET",
        headers: fileHeaders(strangerCookie, orgB),
      });
      expect(metaRes.status).toBe(404);

      // A legitimately signed token for orgB cannot resolve orgA's file: the
      // token's organizationId scopes the lookup, so the answer is 404.
      const crossTenantToken = createSignedDownloadToken(SIGNED_URL_SECRET, {
        fileId: file.id,
        organizationId: orgB,
        expiresAt: new Date(Date.now() + 3600_000),
      });
      const crossTenantRes = await requireApp().request(
        `/api/v1/files/download?token=${crossTenantToken}`,
        { method: "GET" },
      );
      expect(crossTenantRes.status).toBe(404);

      const listRes = await requireApp().request("/api/v1/files", {
        method: "GET",
        headers: fileHeaders(strangerCookie, orgB),
      });
      expect(listRes.status).toBe(200);
      expect(((await listRes.json()) as { files: unknown[] }).files).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "a soft-deleted file is no longer downloadable even with a previously valid token",
    async () => {
      const email = uniqueEmail("files-deleter");
      await signUp(email);
      const cookie = await signIn(email);
      const organizationId = await createOrganization(cookie, "Files Delete Inc");

      const { file, downloadUrl } = await uploadFile(cookie, organizationId, "to be deleted");

      const delRes = await requireApp().request(`/api/v1/files/${file.id}`, {
        method: "DELETE",
        headers: fileHeaders(cookie, organizationId),
      });
      expect(delRes.status).toBe(204);

      const downloadRes = await requireApp().request(await downloadPath(downloadUrl), {
        method: "GET",
      });
      expect(downloadRes.status).toBe(404);
    },
    TEST_TIMEOUT_MS,
  );
});
