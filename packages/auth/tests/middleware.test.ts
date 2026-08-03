import { expect, test } from "bun:test";
import { Hono } from "hono";

import {
  createSessionMiddleware,
  SESSION_COOKIE_NAME,
  type SessionResolver,
  type SessionVariables,
} from "../src/session-middleware";

function createTestApp(resolver: SessionResolver) {
  const app = new Hono<{ Variables: SessionVariables }>();
  let variables: { user: unknown; session: unknown } | undefined;

  app.use("*", createSessionMiddleware(resolver));
  app.get("/state", (c) => {
    variables = { user: c.get("user"), session: c.get("session") };
    return c.text("ok");
  });

  return { app, getVariables: () => variables };
}

test("returns anonymous state without resolving absent credentials", async () => {
  let resolverCalls = 0;
  const resolver: SessionResolver = {
    getSession: async () => {
      resolverCalls += 1;
      return null;
    },
  };
  const { app, getVariables } = createTestApp(resolver);

  const response = await app.request("http://localhost/state");

  expect(response.status).toBe(200);
  expect(await response.text()).toBe("ok");
  expect(resolverCalls).toBe(0);
  expect(getVariables()).toEqual({ user: null, session: null });
});

test("fails closed to anonymous state when session resolution throws", async () => {
  const resolver: SessionResolver = {
    getSession: async () => {
      throw new Error("database unavailable");
    },
  };
  const { app, getVariables } = createTestApp(resolver);

  const response = await app.request("http://localhost/state", {
    headers: { cookie: `${SESSION_COOKIE_NAME}=session-token` },
  });

  expect(response.status).toBe(200);
  expect(await response.text()).toBe("ok");
  expect(getVariables()).toEqual({ user: null, session: null });
});

test("keeps auth imports isolated from business modules and test utilities", async () => {
  const sourceFiles = ["auth.schema.ts", "auth.ts", "db.ts", "index.ts", "session-middleware.ts"];
  const sources = await Promise.all(
    sourceFiles.map((file) => Bun.file(new URL(`../src/${file}`, import.meta.url)).text()),
  );
  const manifest = await Bun.file(new URL("../package.json", import.meta.url)).json();
  const source = sources.join("\n");

  expect(source).not.toMatch(/@consulting\/(?:module|config|core|contracts)/);
  expect(source).toContain('from "better-auth"');
  expect(manifest.dependencies).not.toHaveProperty("@better-auth/test-utils");
  expect(manifest.devDependencies).toBeUndefined();
});
