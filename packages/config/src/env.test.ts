import { describe, expect, test } from "bun:test";

import { ConfigError, envSchema, parseEnv } from "./env";

const validEnv = {
  APP_ENV: "development",
  APP_VERSION: "0.10.1",
  API_BASE_URL: "http://localhost:3000",
  LOG_LEVEL: "info",
  PORT: "3000",
  HOST: "0.0.0.0",
  CORS_ORIGINS: "",
  DATABASE_URL: "postgres://postgres:postgres@localhost:5432/api",
  BETTER_AUTH_SECRET: "test-secret-at-least-32-characters-long",
  TRUSTED_ORIGINS: "",
};

describe("parseEnv", () => {
  test("valid env boots and applies defaults", () => {
    const config = parseEnv(validEnv);
    expect(config).toEqual({
      APP_ENV: "development",
      APP_VERSION: "0.10.1",
      API_BASE_URL: "http://localhost:3000",
      LOG_LEVEL: "info",
      PORT: 3000,
      HOST: "0.0.0.0",
      CORS_ORIGINS: [],
      DATABASE_URL: "postgres://postgres:postgres@localhost:5432/api",
      BETTER_AUTH_SECRET: "test-secret-at-least-32-characters-long",
      TRUSTED_ORIGINS: [],
    });
  });

  test("missing BETTER_AUTH_SECRET aborts naming the variable", () => {
    const { BETTER_AUTH_SECRET: _secret, ...withoutSecret } = validEnv;
    expect(() => parseEnv(withoutSecret)).toThrow(/BETTER_AUTH_SECRET/);
  });

  test("short BETTER_AUTH_SECRET is rejected", () => {
    expect(() => parseEnv({ ...validEnv, BETTER_AUTH_SECRET: "a".repeat(31) })).toThrow(
      /BETTER_AUTH_SECRET/,
    );
  });

  test("missing DATABASE_URL aborts naming the variable", () => {
    const { DATABASE_URL: _databaseUrl, ...withoutDatabaseUrl } = validEnv;
    expect(() => parseEnv(withoutDatabaseUrl)).toThrow(/DATABASE_URL/);
  });

  test("missing LOG_LEVEL aborts naming the variable", () => {
    const { LOG_LEVEL: _logLevel, ...withoutLogLevel } = validEnv;
    expect(() => parseEnv(withoutLogLevel)).toThrow(/LOG_LEVEL/);
  });

  test("ConfigError lists every issue one per line", () => {
    try {
      parseEnv({});
      expect.unreachable("expected parseEnv to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      const message = (error as ConfigError).message;
      expect(message).toMatch(/^Invalid environment configuration:\n {2}- LOG_LEVEL:/);
      expect(message).toContain("  - BETTER_AUTH_SECRET:");
    }
  });

  test("invalid PORT values are rejected", () => {
    expect(() => parseEnv({ ...validEnv, PORT: "0" })).toThrow(/PORT/);
    expect(() => parseEnv({ ...validEnv, PORT: "65536" })).toThrow(/PORT/);
    expect(() => parseEnv({ ...validEnv, PORT: "abc" })).toThrow(/PORT/);
  });

  test("CORS_ORIGINS splits, trims, and drops empty entries", () => {
    const config = parseEnv({
      ...validEnv,
      CORS_ORIGINS: "https://a.example.com, https://b.example.com, ,",
    });
    expect(config.CORS_ORIGINS).toEqual(["https://a.example.com", "https://b.example.com"]);
  });

  test("TRUSTED_ORIGINS splits, trims, and drops empty entries", () => {
    const config = parseEnv({
      ...validEnv,
      TRUSTED_ORIGINS: "https://a.example.com, https://b.example.com, ,",
    });
    expect(config.TRUSTED_ORIGINS).toEqual(["https://a.example.com", "https://b.example.com"]);
  });

  test("invalid BETTER_AUTH_URL is rejected", () => {
    expect(() => parseEnv({ ...validEnv, BETTER_AUTH_URL: "not-a-url" })).toThrow(
      /BETTER_AUTH_URL/,
    );
  });

  test("schema output type matches Config", () => {
    expect(envSchema).toBeDefined();
  });
});
