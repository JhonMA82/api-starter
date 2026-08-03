import { afterEach, describe, expect, test, vi } from "bun:test";
import type { Config } from "@consulting/config";
import {
  HealthResponse,
  ProblemDetailsSchema,
  ReadyResponse,
  VersionResponse,
} from "@consulting/contracts";
import { HTTPException } from "hono/http-exception";
import { createApp } from "../src/app";

const config: Config = {
  APP_ENV: "test",
  APP_VERSION: "0.1.0",
  API_BASE_URL: "http://localhost:3000",
  LOG_LEVEL: "debug",
  PORT: 3000,
  HOST: "0.0.0.0",
  CORS_ORIGINS: ["https://app.example.com"],
};

const app = createApp(config);

describe("health check", () => {
  test("GET /health returns 200 with a structured log line", async () => {
    const logSpy = vi.spyOn(console, "log");

    const res = await app.request("/health");

    expect(res.status).toBe(200);
    const body = await res.json();
    HealthResponse.parse(body);
    expect(body.status).toBe("ok");

    expect(logSpy).toHaveBeenCalledTimes(1);
    const line = logSpy.mock.calls[0]?.[0];
    expect(typeof line).toBe("string");
    const entry = JSON.parse(line as string) as Record<string, unknown>;
    expect(entry.timestamp).toBeString();
    expect(entry.level).toBe("info");
    expect(entry.service).toBe("@consulting/api");
    expect(entry.environment).toBe("test");
    expect(entry.version).toBe("0.1.0");
    expect(entry.requestId).toBeString();
    expect(entry.requestId).not.toBe("");
    expect(entry.route).toBe("GET /health");
    expect(entry.status).toBe(200);
    expect(entry.duration).toBeNumber();
    expect(Object.keys(entry)).toHaveLength(9);
  });
});

describe("base routes", () => {
  test("GET /ready returns 200 parsing against ReadyResponse", async () => {
    const res = await app.request("/ready");
    expect(res.status).toBe(200);
    ReadyResponse.parse(await res.json());
  });

  test("GET /version returns name, version, and environment", async () => {
    const res = await app.request("/version");
    expect(res.status).toBe(200);
    const body = await res.json();
    VersionResponse.parse(body);
    expect(body).toEqual({
      name: "@consulting/api",
      version: "0.1.0",
      environment: "test",
    });
  });
});

describe("cors allowlist", () => {
  test("preflight from an origin outside the allowlist gets no allow-origin header", async () => {
    const res = await app.request("/health", {
      method: "OPTIONS",
      headers: {
        Origin: "https://evil.example",
        "Access-Control-Request-Method": "GET",
      },
    });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  test("preflight from an allowed origin gets the allow-origin header", async () => {
    const res = await app.request("/health", {
      method: "OPTIONS",
      headers: {
        Origin: "https://app.example.com",
        "Access-Control-Request-Method": "GET",
      },
    });
    expect(res.headers.get("access-control-allow-origin")).toBe("https://app.example.com");
  });
});

describe("error normalization", () => {
  test("unknown route returns 404 problem+json without a stack trace", async () => {
    const res = await app.request("/missing");
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
    const body = await res.json();
    ProblemDetailsSchema.parse(body);
    expect(body.code).toBe("NOT_FOUND");
    expect(body.requestId).toBeString();
    expect(JSON.stringify(body)).not.toContain("stack");
  });

  test("oversized body returns 413 BODY_TOO_LARGE problem+json", async () => {
    const res = await app.request("/health", {
      method: "POST",
      body: "x".repeat(2_000_000),
    });
    expect(res.status).toBe(413);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
    const body = await res.json();
    ProblemDetailsSchema.parse(body);
    expect(body.code).toBe("BODY_TOO_LARGE");
  });

  test("HTTPException(408) normalizes to 408 REQUEST_TIMEOUT problem+json", async () => {
    const testApp = createApp(config);
    testApp.get("/timeout-test", () => {
      throw new HTTPException(408);
    });
    const res = await testApp.request("/timeout-test");
    expect(res.status).toBe(408);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
    const body = await res.json();
    ProblemDetailsSchema.parse(body);
    expect(body.code).toBe("REQUEST_TIMEOUT");
    expect(body.instance).toBe("/timeout-test");
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
