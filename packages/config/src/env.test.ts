import { describe, expect, test } from "bun:test";

import { ConfigError, envSchema, parseEnv } from "./env";

const validEnv = {
  APP_ENV: "development",
  APP_VERSION: "0.1.0",
  API_BASE_URL: "http://localhost:3000",
  LOG_LEVEL: "info",
  PORT: "3000",
  HOST: "0.0.0.0",
  CORS_ORIGINS: "",
};

describe("parseEnv", () => {
  test("valid env boots and applies defaults", () => {
    const config = parseEnv(validEnv);
    expect(config).toEqual({
      APP_ENV: "development",
      APP_VERSION: "0.1.0",
      API_BASE_URL: "http://localhost:3000",
      LOG_LEVEL: "info",
      PORT: 3000,
      HOST: "0.0.0.0",
      CORS_ORIGINS: [],
    });
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

  test("schema output type matches Config", () => {
    expect(envSchema).toBeDefined();
  });
});
