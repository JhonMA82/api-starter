import { describe, expect, test } from "bun:test";
import type { Config } from "@consulting/config";
import type { OpenAPIV3_1 } from "openapi-types";
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

const app = createApp(config);

describe("auth openapi document", () => {
  test("GET /api/auth/open-api/generate-schema returns a valid OpenAPI 3.1.1 document", async () => {
    const res = await app.request("/api/auth/open-api/generate-schema");
    expect(res.status).toBe(200);
    const doc = (await res.json()) as OpenAPIV3_1.Document;
    expect(doc.openapi).toBe("3.1.1");
    expect(Object.keys(doc.paths ?? {})).not.toHaveLength(0);
    expect(Object.keys(doc.paths ?? {}).some((path) => path.includes("sign-in/email"))).toBe(true);
  });
});
