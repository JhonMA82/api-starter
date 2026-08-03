import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type Auth, createAuth } from "@consulting/auth";
import type { Config } from "@consulting/config";
import { ProblemDetailsSchema } from "@consulting/contracts";
import { HTTPException } from "hono/http-exception";

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
  console.warn("[auth tests] DATABASE_URL is not set — skipping real-DB tests");
}

const PASSWORD = "password-123456";
const TEST_TIMEOUT_MS = 30_000;

type AuthUser = {
  email: string;
};

type AuthSession = {
  id: string;
  token: string;
};

type AuthResponse = {
  user: AuthUser | null;
  session: AuthSession | null;
};

type TestApp = ReturnType<typeof createApp>;

let app: TestApp | undefined;
let sequence = 0;

function requireApp(): TestApp {
  if (app === undefined) {
    throw new Error("auth test app was not initialized");
  }
  return app;
}

function uniqueEmail(prefix: string): string {
  sequence += 1;
  return `${prefix}-${Date.now()}-${sequence}@example.com`;
}

function jsonHeaders(origin?: string, extra?: Record<string, string>): Headers {
  const headers = new Headers({ "content-type": "application/json", ...extra });
  if (origin !== undefined) {
    headers.set("origin", origin);
  }
  return headers;
}

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

function sessionCookie(setCookie: string | null): string {
  const match = setCookie?.match(/better-auth\.session_token=[^;]+/);
  expect(match, "Better Auth did not set a session cookie").not.toBeNull();
  return match?.[0] ?? "";
}

function expectCookieAttributes(setCookie: string | null, secure: boolean): void {
  expect(setCookie).not.toBeNull();
  expect(setCookie).toContain("HttpOnly");
  expect(setCookie).toContain("SameSite=Lax");
  expect(setCookie).toContain("Path=/");
  if (secure) {
    expect(setCookie).toContain("Secure");
  } else {
    expect(setCookie).not.toContain("Secure");
  }
}

async function postAuth(
  path: string,
  body: Record<string, string>,
  options: { origin?: string; headers?: Record<string, string> },
  target: TestApp,
): Promise<Response> {
  return target.request(path, {
    method: "POST",
    headers: jsonHeaders(options.origin, options.headers),
    body: JSON.stringify(body),
  });
}

async function signUp(email: string): Promise<Response> {
  return postAuth(
    "/api/auth/sign-up/email",
    { name: "Auth Test User", email, password: PASSWORD },
    {},
    requireApp(),
  );
}

async function signIn(
  email: string,
  origin?: string,
  target: TestApp = requireApp(),
): Promise<Response> {
  return postAuth(
    "/api/auth/sign-in/email",
    { email, password: PASSWORD },
    origin === undefined ? {} : { origin },
    target,
  );
}

async function getSession(
  cookie: string,
  target: TestApp = requireApp(),
): Promise<AuthResponse | null> {
  const response = await target.request("/api/auth/get-session", { headers: { cookie } });
  expect(response.status).toBe(200);
  return readJson<AuthResponse>(response);
}

function requireSessionResponse(response: AuthResponse | null): AuthResponse {
  if (response === null) {
    throw new Error("expected an authenticated session response");
  }
  return response;
}

describeDb("authenticated API (real database)", () => {
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
    TRUSTED_ORIGINS: ["https://app.example.com"],
  };
  let auth: Auth | undefined;

  beforeAll(async () => {
    await resetDatabase(client);
    await migrateToLatest(client);

    const createdAuth = createAuth({
      secret: config.BETTER_AUTH_SECRET,
      baseURL: config.BETTER_AUTH_URL ?? config.API_BASE_URL,
      trustedOrigins: [...config.TRUSTED_ORIGINS, new URL(config.API_BASE_URL).origin],
      databaseUrl: config.DATABASE_URL,
    });
    auth = createdAuth;
    app = createApp(config, { auth: createdAuth });
    app.get("/api/v1/auth-required", (c) => {
      const user = c.get("user");
      if (user === null) {
        throw new HTTPException(401);
      }
      return c.json({ email: user.email });
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
    "runs signup, cookie session, signout, token revoke, and protected 401",
    async () => {
      const email = uniqueEmail("flow");
      const signupResponse = await signUp(email);
      expect(signupResponse.status).toBe(200);
      const signupBody = await readJson<AuthResponse>(signupResponse);
      expect(signupBody.user?.email).toBe(email);
      expectCookieAttributes(signupResponse.headers.get("set-cookie"), false);

      const signInResponse = await signIn(email);
      expect(signInResponse.status).toBe(200);
      const cookie = sessionCookie(signInResponse.headers.get("set-cookie"));
      const sessionBody = requireSessionResponse(await getSession(cookie));
      expect(sessionBody.user?.email).toBe(email);
      expect(sessionBody.session).not.toBeNull();
      const session = sessionBody.session as AuthSession;
      expect(session.id).not.toBe(session.token);

      const signoutResponse = await postAuth(
        "/api/auth/sign-out",
        {},
        { origin: "http://localhost:3000", headers: { cookie } },
        requireApp(),
      );
      expect(signoutResponse.status).toBe(200);
      const afterSignout = await getSession(cookie);
      expect(afterSignout).toBeNull();

      const secondSignInResponse = await signIn(email);
      expect(secondSignInResponse.status).toBe(200);
      const secondCookie = sessionCookie(secondSignInResponse.headers.get("set-cookie"));
      const activeBody = requireSessionResponse(await getSession(secondCookie));
      expect(activeBody.session).not.toBeNull();
      const activeSession = activeBody.session as AuthSession;

      const wrongRevokeResponse = await postAuth(
        "/api/auth/revoke-session",
        { token: activeSession.id },
        { origin: "http://localhost:3000", headers: { cookie: secondCookie } },
        requireApp(),
      );
      expect(wrongRevokeResponse.status).toBe(200);
      const afterWrongRevoke = requireSessionResponse(await getSession(secondCookie));
      expect(afterWrongRevoke.session?.id).toBe(activeSession.id);
      expect(afterWrongRevoke.session?.token).toBe(activeSession.token);

      const revokeResponse = await postAuth(
        "/api/auth/revoke-session",
        { token: activeSession.token },
        { origin: "http://localhost:3000", headers: { cookie: secondCookie } },
        requireApp(),
      );
      expect(revokeResponse.status).toBe(200);
      expect(await getSession(secondCookie)).toBeNull();

      const protectedResponse = await requireApp().request("/api/v1/auth-required", {
        headers: { cookie: secondCookie },
      });
      expect(protectedResponse.status).toBe(401);
      expect(protectedResponse.headers.get("content-type")).toContain("application/problem+json");
      const problem = await readJson<unknown>(protectedResponse);
      ProblemDetailsSchema.parse(problem);
      expect(problem).toMatchObject({
        status: 401,
        code: "INTERNAL_ERROR",
        instance: "/api/v1/auth-required",
      });
      expect(JSON.stringify(problem)).not.toContain("stack");
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "enforces cookie attributes and the origin security matrix",
    async () => {
      const email = uniqueEmail("security");
      const signupResponse = await signUp(email);
      expect(signupResponse.status).toBe(200);

      const httpResponse = await signIn(email);
      expect(httpResponse.status).toBe(200);
      expectCookieAttributes(httpResponse.headers.get("set-cookie"), false);

      const foreignResponse = await signIn(email, "https://evil.example");
      expect(foreignResponse.status).toBe(403);
      const foreignBody = await readJson<{ code?: string }>(foreignResponse);
      expect(foreignBody.code).toBe("INVALID_ORIGIN");

      const noOriginResponse = await signIn(email);
      expect(noOriginResponse.status).toBe(200);

      const foreignGetResponse = await requireApp().request("/api/auth/get-session", {
        headers: { Origin: "https://evil.example" },
      });
      expect(foreignGetResponse.status).toBe(200);
      expect(await readJson<AuthResponse | null>(foreignGetResponse)).toBeNull();

      const trustedResponse = await signIn(email, "https://app.example.com");
      expect(trustedResponse.status).toBe(200);

      const selfResponse = await signIn(email, "http://localhost:3000");
      expect(selfResponse.status).toBe(200);

      const httpsAuth = createAuth({
        secret: config.BETTER_AUTH_SECRET,
        baseURL: "https://api.example.com",
        trustedOrigins: ["https://api.example.com"],
        databaseUrl: config.DATABASE_URL,
      });
      try {
        const httpsConfig: Config = {
          ...config,
          API_BASE_URL: "https://api.example.com",
          TRUSTED_ORIGINS: [],
        };
        const httpsApp = createApp(httpsConfig, { auth: httpsAuth });
        const httpsResponse = await signIn(email, "https://api.example.com", httpsApp);
        expect(httpsResponse.status).toBe(200);
        expectCookieAttributes(httpsResponse.headers.get("set-cookie"), true);
      } finally {
        await httpsAuth.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "issues, accepts, and revokes bearer tokens",
    async () => {
      const email = uniqueEmail("bearer");
      const signupResponse = await signUp(email);
      expect(signupResponse.status).toBe(200);

      const signInResponse = await signIn(email);
      expect(signInResponse.status).toBe(200);
      const token = signInResponse.headers.get("set-auth-token");
      expect(token).toBeString();
      expect(token).not.toBe("");
      if (token === null) {
        throw new Error("Better Auth did not issue a bearer token");
      }

      const bearerHeaders = { authorization: `Bearer ${token}` };
      const bearerSessionResponse = await requireApp().request("/api/auth/get-session", {
        headers: bearerHeaders,
      });
      expect(bearerSessionResponse.status).toBe(200);
      const bearerSession = await readJson<AuthResponse>(bearerSessionResponse);
      expect(bearerSession.user?.email).toBe(email);
      expect(bearerSession.session).not.toBeNull();
      if (bearerSession.session === null) {
        throw new Error("bearer session was not returned");
      }
      const sessionToken = bearerSession.session.token;
      expect(token).toContain(`${sessionToken}.`);

      const revokeResponse = await postAuth(
        "/api/auth/revoke-session",
        { token: sessionToken },
        { headers: bearerHeaders },
        requireApp(),
      );
      expect(revokeResponse.status).toBe(200);

      const revokedBearerResponse = await requireApp().request("/api/auth/get-session", {
        headers: bearerHeaders,
      });
      expect(revokedBearerResponse.status).toBe(200);
      expect(await readJson<AuthResponse | null>(revokedBearerResponse)).toBeNull();
    },
    TEST_TIMEOUT_MS,
  );
});
