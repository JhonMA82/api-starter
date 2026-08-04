import { describe, expect, test } from "bun:test";
import type { Config } from "@consulting/config";
import { ForbiddenOrganizationActionError } from "@consulting/module-organizations";
import type { Context } from "hono";

import { createApp } from "../../../apps/api/src/app";
import {
  createFakeRepositories,
  makeMembership,
  makeOrganization,
} from "../../organizations/tests/fakes";
import {
  createInMemoryFileStorage,
  createSha256Hasher,
  createSignedDownloadToken,
  type MembershipGuard,
} from "../src";
import { createFakeFileRepository } from "./fakes";

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

const SIGNED_URL_SECRET = "test-signed-url-secret";
const BASE_URL = "http://localhost:3000";

const OWNER = { id: "user-1", email: "owner@example.com" };
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

function buildApp(options: { guard?: MembershipGuard; maxUploadBytes?: number } = {}) {
  const repos = createFakeRepositories();
  repos.organizationStore.set("org-1", makeOrganization({ id: "org-1", slug: "acme-inc" }));
  repos.membershipStore.set(
    "membership-1",
    makeMembership({ id: "membership-1", userId: OWNER.id, role: "owner" }),
  );

  const files = createFakeFileRepository();
  const storage = createInMemoryFileStorage();

  const app = createApp(config, {
    auth: stubAuth(OWNER),
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
    files: {
      files,
      storage,
      hash: createSha256Hasher(),
      signedUrlSecret: SIGNED_URL_SECRET,
      baseUrl: BASE_URL,
      ...(options.guard === undefined ? {} : { guard: options.guard }),
      ...(options.maxUploadBytes === undefined ? {} : { maxUploadBytes: options.maxUploadBytes }),
    },
  });
  return { app, files, storage };
}

function orgHeaders(options: { cookie?: string } = {}) {
  const headers: Record<string, string> = { [ORG_HEADER]: "org-1" };
  if (options.cookie !== undefined) {
    headers.cookie = options.cookie;
  }
  return headers;
}

function defaultForm(): FormData {
  const form = new FormData();
  form.append("file", new File(["hello files"], "notes.txt", { type: "text/plain" }));
  return form;
}

function uploadRequest(options: { cookie?: string; form?: FormData } = {}) {
  const form = options.form ?? defaultForm();
  return {
    method: "POST",
    headers: orgHeaders(options.cookie === undefined ? {} : { cookie: options.cookie }),
    body: form,
  };
}

async function problem(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

async function uploadFile(app: ReturnType<typeof buildApp>["app"]): Promise<{
  file: { id: string };
  downloadUrl: string;
}> {
  const res = await app.request("/api/v1/files", uploadRequest({ cookie: SESSION_COOKIE }));
  expect(res.status).toBe(201);
  return (await res.json()) as { file: { id: string }; downloadUrl: string };
}

describe("POST /api/v1/files", () => {
  test("uploads a multipart file with 201 and returns metadata plus a signed download URL", async () => {
    const { app, storage } = buildApp();

    const res = await app.request("/api/v1/files", uploadRequest({ cookie: SESSION_COOKIE }));

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      file: Record<string, unknown>;
      downloadUrl: string;
      expiresIn: number;
    };
    expect(body.file).toMatchObject({
      organizationId: "org-1",
      name: "notes.txt",
      mimeType: "text/plain",
      sizeBytes: 11,
      status: "stored",
      deletedAt: null,
    });
    expect(body.file.id).toBeString();
    expect(body.file.sha256).toBe(createSha256Hasher().hash(Buffer.from("hello files")));
    expect(body.file.storageKey).toBeUndefined();
    expect(body.expiresIn).toBe(3600);
    expect(body.downloadUrl).toMatch(/^http:\/\/localhost:3000\/api\/v1\/files\/download\?token=/);
    expect(storage.entries().size).toBe(1);
  });

  test("rejects an upload with no session with 401", async () => {
    const { app } = buildApp();
    const res = await app.request("/api/v1/files", uploadRequest());
    expect(res.status).toBe(401);
    expect(await problem(res)).toMatchObject({ status: 401, code: "UNAUTHORIZED" });
  });

  test("rejects a missing file field with 400", async () => {
    const { app } = buildApp();
    const form = new FormData();
    form.append("other", "not a file");
    const res = await app.request("/api/v1/files", uploadRequest({ cookie: SESSION_COOKIE, form }));
    expect(res.status).toBe(400);
    expect(await problem(res)).toMatchObject({ status: 400, code: "VALIDATION_FAILED" });
  });

  test("rejects a disallowed MIME type with 400", async () => {
    const { app } = buildApp();
    const form = new FormData();
    form.append("file", new File(["<script>"], "evil.html", { type: "text/html" }));
    const res = await app.request("/api/v1/files", uploadRequest({ cookie: SESSION_COOKIE, form }));
    expect(res.status).toBe(400);
    expect(await problem(res)).toMatchObject({ status: 400, code: "VALIDATION_FAILED" });
  });

  test("rejects an oversized upload with 400", async () => {
    const { app } = buildApp({ maxUploadBytes: 5 });
    const form = new FormData();
    form.append("file", new File(["0123456789"], "big.txt", { type: "text/plain" }));
    const res = await app.request("/api/v1/files", uploadRequest({ cookie: SESSION_COOKIE, form }));
    expect(res.status).toBe(400);
    expect(await problem(res)).toMatchObject({ status: 400, code: "VALIDATION_FAILED" });
  });

  test("maps a guard denial to 403 FORBIDDEN", async () => {
    const guard: MembershipGuard = {
      async assertCanManage() {
        throw new ForbiddenOrganizationActionError("files are disabled for this organization");
      },
    };
    const { app } = buildApp({ guard });
    const res = await app.request("/api/v1/files", uploadRequest({ cookie: SESSION_COOKIE }));
    expect(res.status).toBe(403);
    expect(await problem(res)).toMatchObject({ status: 403, code: "FORBIDDEN" });
  });
});

describe("GET /api/v1/files", () => {
  test("lists stored files with a signed download URL per file", async () => {
    const { app } = buildApp();
    await uploadFile(app);
    const secondForm = new FormData();
    secondForm.append("file", new File(["second"], "second.txt", { type: "text/plain" }));
    await app.request("/api/v1/files", uploadRequest({ cookie: SESSION_COOKIE, form: secondForm }));

    const res = await app.request("/api/v1/files?limit=10", {
      method: "GET",
      headers: orgHeaders({ cookie: SESSION_COOKIE }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { files: Record<string, unknown>[] };
    expect(body.files).toHaveLength(2);
    for (const file of body.files) {
      expect(file.downloadUrl).toMatch(
        /^http:\/\/localhost:3000\/api\/v1\/files\/download\?token=/,
      );
    }
  });

  test("requires a session with 401", async () => {
    const { app } = buildApp();
    const res = await app.request("/api/v1/files", { method: "GET", headers: orgHeaders() });
    expect(res.status).toBe(401);
  });
});

describe("GET /api/v1/files/:id", () => {
  test("returns metadata with a signed download URL", async () => {
    const { app } = buildApp();
    const { file } = await uploadFile(app);

    const res = await app.request(`/api/v1/files/${file.id}`, {
      method: "GET",
      headers: orgHeaders({ cookie: SESSION_COOKIE }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ id: file.id, name: "notes.txt", status: "stored" });
    expect(body.downloadUrl).toMatch(/^http:\/\/localhost:3000\/api\/v1\/files\/download\?token=/);
  });

  test("returns 404 for an unknown file", async () => {
    const { app } = buildApp();
    const res = await app.request("/api/v1/files/missing-file-id", {
      method: "GET",
      headers: orgHeaders({ cookie: SESSION_COOKIE }),
    });
    expect(res.status).toBe(404);
    expect(await problem(res)).toMatchObject({ status: 404, code: "NOT_FOUND" });
  });
});

describe("DELETE /api/v1/files/:id", () => {
  test("soft-deletes with 204 and the metadata afterwards is 404", async () => {
    const { app } = buildApp();
    const { file } = await uploadFile(app);

    const delRes = await app.request(`/api/v1/files/${file.id}`, {
      method: "DELETE",
      headers: orgHeaders({ cookie: SESSION_COOKIE }),
    });
    expect(delRes.status).toBe(204);

    const metaRes = await app.request(`/api/v1/files/${file.id}`, {
      method: "GET",
      headers: orgHeaders({ cookie: SESSION_COOKIE }),
    });
    expect(metaRes.status).toBe(404);
  });

  test("returns 404 when deleting an unknown file", async () => {
    const { app } = buildApp();
    const res = await app.request("/api/v1/files/missing-file-id", {
      method: "DELETE",
      headers: orgHeaders({ cookie: SESSION_COOKIE }),
    });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/v1/files/:id/url", () => {
  test("issues a fresh signed URL with a default validity of 1 hour", async () => {
    const { app } = buildApp();
    const { file } = await uploadFile(app);

    const res = await app.request(`/api/v1/files/${file.id}/url`, {
      method: "POST",
      headers: { ...orgHeaders({ cookie: SESSION_COOKIE }), "content-type": "application/json" },
      body: "{}",
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { downloadUrl: string; expiresIn: number };
    expect(body.expiresIn).toBe(3600);
    expect(body.downloadUrl).toMatch(/^http:\/\/localhost:3000\/api\/v1\/files\/download\?token=/);
  });

  test("honors a client-requested validity up to 24 hours", async () => {
    const { app } = buildApp();
    const { file } = await uploadFile(app);

    const res = await app.request(`/api/v1/files/${file.id}/url`, {
      method: "POST",
      headers: { ...orgHeaders({ cookie: SESSION_COOKIE }), "content-type": "application/json" },
      body: JSON.stringify({ expiresInSeconds: 7200 }),
    });

    expect(res.status).toBe(200);
    expect(((await res.json()) as { expiresIn: number }).expiresIn).toBe(7200);
  });

  test("rejects a validity above 24 hours with 400", async () => {
    const { app } = buildApp();
    const { file } = await uploadFile(app);

    const res = await app.request(`/api/v1/files/${file.id}/url`, {
      method: "POST",
      headers: { ...orgHeaders({ cookie: SESSION_COOKIE }), "content-type": "application/json" },
      body: JSON.stringify({ expiresInSeconds: 90000 }),
    });

    expect(res.status).toBe(400);
    expect(await problem(res)).toMatchObject({ status: 400, code: "VALIDATION_FAILED" });
  });

  test("returns 404 for an unknown file", async () => {
    const { app } = buildApp();
    const res = await app.request("/api/v1/files/missing-file-id/url", {
      method: "POST",
      headers: { ...orgHeaders({ cookie: SESSION_COOKIE }), "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(404);
  });
});

describe("GET /api/v1/files/download (public)", () => {
  test("downloads the exact bytes with the stored content-type and an attachment disposition", async () => {
    const { app } = buildApp();
    const { downloadUrl } = await uploadFile(app);
    const url = new URL(downloadUrl);

    const res = await app.request(url.pathname + url.search, { method: "GET" });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain");
    expect(res.headers.get("content-disposition")).toContain('attachment; filename="notes.txt"');
    expect(new TextDecoder().decode(await res.arrayBuffer())).toBe("hello files");
  });

  test("serves a download with a token issued by POST /files/:id/url", async () => {
    const { app } = buildApp();
    const { file } = await uploadFile(app);
    const urlRes = await app.request(`/api/v1/files/${file.id}/url`, {
      method: "POST",
      headers: { ...orgHeaders({ cookie: SESSION_COOKIE }), "content-type": "application/json" },
      body: "{}",
    });
    const { downloadUrl } = (await urlRes.json()) as { downloadUrl: string };
    const url = new URL(downloadUrl);

    const res = await app.request(url.pathname + url.search, { method: "GET" });
    expect(res.status).toBe(200);
    expect(new TextDecoder().decode(await res.arrayBuffer())).toBe("hello files");
  });

  test("rejects an invalid (tampered) token with 401", async () => {
    const { app } = buildApp();
    const { file } = await uploadFile(app);
    const token = createSignedDownloadToken(SIGNED_URL_SECRET, {
      fileId: file.id,
      organizationId: "org-1",
      expiresAt: new Date(Date.now() + 3600_000),
    });
    const separatorIndex = token.lastIndexOf(".");
    // The payload is base64url-encoded, so decode it, tamper the file id, and
    // re-encode: the signature now covers a different payload -> 401.
    const decoded = Buffer.from(token.slice(0, separatorIndex), "base64url").toString("utf8");
    const tamperedPayload = Buffer.from(decoded.replace(file.id, "other")).toString("base64url");
    const tampered = tamperedPayload + token.slice(separatorIndex);

    const res = await app.request(`/api/v1/files/download?token=${tampered}`, { method: "GET" });
    expect(res.status).toBe(401);
    expect(await problem(res)).toMatchObject({ status: 401, code: "UNAUTHORIZED" });
  });

  test("rejects an expired token with 401", async () => {
    const { app } = buildApp();
    const { file } = await uploadFile(app);
    const token = createSignedDownloadToken(SIGNED_URL_SECRET, {
      fileId: file.id,
      organizationId: "org-1",
      expiresAt: new Date(Date.now() - 1000),
    });

    const res = await app.request(`/api/v1/files/download?token=${token}`, { method: "GET" });
    expect(res.status).toBe(401);
    expect(await problem(res)).toMatchObject({ status: 401, code: "UNAUTHORIZED" });
  });

  test("rejects a token signed with a different secret with 401", async () => {
    const { app } = buildApp();
    const { file } = await uploadFile(app);
    const token = createSignedDownloadToken("wrong-secret", {
      fileId: file.id,
      organizationId: "org-1",
      expiresAt: new Date(Date.now() + 3600_000),
    });

    const res = await app.request(`/api/v1/files/download?token=${token}`, { method: "GET" });
    expect(res.status).toBe(401);
  });

  test("rejects a missing token with 400", async () => {
    const { app } = buildApp();
    const res = await app.request("/api/v1/files/download", { method: "GET" });
    expect(res.status).toBe(400);
    expect(await problem(res)).toMatchObject({ status: 400, code: "VALIDATION_FAILED" });
  });

  test("rejects a valid token for a missing file with 404", async () => {
    const { app } = buildApp();
    const token = createSignedDownloadToken(SIGNED_URL_SECRET, {
      fileId: "missing-file",
      organizationId: "org-1",
      expiresAt: new Date(Date.now() + 3600_000),
    });
    const res = await app.request(`/api/v1/files/download?token=${token}`, { method: "GET" });
    expect(res.status).toBe(404);
    expect(await problem(res)).toMatchObject({ status: 404, code: "NOT_FOUND" });
  });

  test("rejects a valid token for a soft-deleted file with 404", async () => {
    const { app } = buildApp();
    const { file } = await uploadFile(app);
    await app.request(`/api/v1/files/${file.id}`, {
      method: "DELETE",
      headers: orgHeaders({ cookie: SESSION_COOKIE }),
    });
    const token = createSignedDownloadToken(SIGNED_URL_SECRET, {
      fileId: file.id,
      organizationId: "org-1",
      expiresAt: new Date(Date.now() + 3600_000),
    });

    const res = await app.request(`/api/v1/files/download?token=${token}`, { method: "GET" });
    expect(res.status).toBe(404);
  });
});
