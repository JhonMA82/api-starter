import { describe, expect, test } from "bun:test";
import { type Auth, createSessionMiddleware } from "@consulting/auth";
import type { Config } from "@consulting/config";
import { createApp } from "../src/app";

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

const FAKE_USER = {
  id: "user-1",
  name: "Admin User",
  email: "admin@example.com",
  emailVerified: true,
  image: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

const FAKE_SESSION = {
  id: "session-1",
  token: "token-1",
  userId: "user-1",
  expiresAt: new Date("2027-01-01T00:00:00Z"),
  ipAddress: null,
  userAgent: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

function stubAuth(user: typeof FAKE_USER | null, session: typeof FAKE_SESSION | null): Auth {
  // Stub replaces the DB-bound createAuth: sessionMiddleware always resolves the
  // fixed fake session (or null) so no database is involved.
  const sessionMiddleware = createSessionMiddleware({
    getSession: async () => (user === null ? null : { user, session }),
  });
  const stub = {
    handler: async () => new Response(null, { status: 404 }),
    sessionMiddleware,
    getSession: async () => null,
    close: async () => {},
  };
  return stub as unknown as Auth;
}

const SESSION_COOKIE = "better-auth.session_token=fake-token";

async function problem(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

describe("HTTP authorization enforcement", () => {
  test("401 UNAUTHORIZED problem+json when unauthenticated", async () => {
    const app = createApp(config, {
      auth: stubAuth(null, null),
      getRoles: async () => ["member"],
    });
    const res = await app.request("/api/v1/authorization/protected");
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
    const body = await problem(res);
    expect(body).toMatchObject({
      status: 401,
      code: "UNAUTHORIZED",
      title: "Unauthorized",
      instance: "/api/v1/authorization/protected",
    });
    expect(body.requestId).toBeString();
    expect(JSON.stringify(body)).not.toContain("stack");
  });

  test("member with request.read can access the protected route", async () => {
    const app = createApp(config, {
      auth: stubAuth(FAKE_USER, FAKE_SESSION),
      getRoles: async () => ["member"],
    });
    const res = await app.request("/api/v1/authorization/protected", {
      headers: { cookie: SESSION_COOKIE },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ email: "admin@example.com" });
  });

  test("member without request.delete gets 403 FORBIDDEN on the admin route", async () => {
    const app = createApp(config, {
      auth: stubAuth(FAKE_USER, FAKE_SESSION),
      getRoles: async () => ["member"],
    });
    const res = await app.request("/api/v1/authorization/admin", {
      headers: { cookie: SESSION_COOKIE },
    });
    expect(res.status).toBe(403);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
    expect(await problem(res)).toMatchObject({
      status: 403,
      code: "FORBIDDEN",
      title: "Forbidden",
      instance: "/api/v1/authorization/admin",
    });
  });

  test("admin with request.delete can access the admin route", async () => {
    const app = createApp(config, {
      auth: stubAuth(FAKE_USER, FAKE_SESSION),
      getRoles: async () => ["admin"],
    });
    const res = await app.request("/api/v1/authorization/admin", {
      headers: { cookie: SESSION_COOKIE },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ email: "admin@example.com" });
  });

  test("denies by default when the resolver returns no roles", async () => {
    const app = createApp(config, {
      auth: stubAuth(FAKE_USER, FAKE_SESSION),
      getRoles: async () => [],
    });
    const res = await app.request("/api/v1/authorization/protected", {
      headers: { cookie: SESSION_COOKIE },
    });
    expect(res.status).toBe(403);
    expect(await problem(res)).toMatchObject({ status: 403, code: "FORBIDDEN" });
  });

  test("defaults getRoles to an empty resolver (deny by default)", async () => {
    const app = createApp(config, { auth: stubAuth(FAKE_USER, FAKE_SESSION) });
    const res = await app.request("/api/v1/authorization/protected", {
      headers: { cookie: SESSION_COOKIE },
    });
    expect(res.status).toBe(403);
  });
});
