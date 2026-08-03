import { expect, test } from "bun:test";

import { createAuthClient } from "../src";

test("creates a browser-safe client with the auth API", () => {
  const client = createAuthClient({ baseURL: "http://localhost:3000" });

  expect(client.signUp.email).toBeFunction();
  expect(client.signIn.email).toBeFunction();
  expect(client.getSession).toBeFunction();
});

test("does not import server-only auth runtime dependencies", async () => {
  const source = await Bun.file(new URL("../src/index.ts", import.meta.url)).text();
  const manifest = await Bun.file(new URL("../package.json", import.meta.url)).json();

  expect(source).toContain('from "better-auth/client"');
  expect(source).not.toMatch(/@better-auth\/drizzle-adapter|drizzle-orm|postgres|from "hono"/);
  expect(manifest.dependencies).toEqual({ "better-auth": "1.6.25" });
});
