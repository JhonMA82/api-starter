import { afterEach, describe, expect, test, vi } from "bun:test";
import type { Auth } from "@consulting/auth";
import type { Config } from "@consulting/config";
import {
  createMetricsRegistry,
  createNoopTracer,
  type MetricsRegistry,
  type Span,
  type Tracer,
} from "@consulting/core";
import type { Context } from "hono";
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

/** Auth whose session middleware sets a fixed user without touching a DB. */
function makeFakeAuth(userId: string): Auth {
  return {
    handler: () => new Response(null, { status: 404 }),
    getSession: async () => null,
    close: () => {},
    sessionMiddleware: async (c: Context, next: () => Promise<void>) => {
      c.set("user", { id: userId, email: "user@example.com", name: "Test User" });
      c.set("session", null);
      await next();
    },
  } as unknown as Auth;
}

describe("GET /metrics", () => {
  test("exposes the registry in Prometheus text format after a request", async () => {
    const registry: MetricsRegistry = createMetricsRegistry();
    const app = createApp(config, { metrics: registry });

    const health = await app.request("/health");
    expect(health.status).toBe(200);

    const res = await app.request("/metrics");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain; version=0.0.4");
    const text = await res.text();
    expect(text).toContain("# TYPE http_requests_total counter");
    expect(text).toContain(
      'http_requests_total{method="GET",route="/health",status_class="2xx"} 1',
    );
    expect(text).toContain("# TYPE http_request_duration_seconds histogram");
    expect(text).toContain(
      'http_request_duration_seconds_count{method="GET",route="/health",status_class="2xx"} 1',
    );
  });

  test("counts 4xx errors into http_errors_total with the same labels", async () => {
    const registry: MetricsRegistry = createMetricsRegistry();
    const app = createApp(config, { metrics: registry });

    const missing = await app.request("/missing");
    expect(missing.status).toBe(404);

    const text = await (await app.request("/metrics")).text();
    expect(text).toContain('http_requests_total{method="GET",route="/*",status_class="4xx"} 1');
    expect(text).toContain('http_errors_total{method="GET",route="/*",status_class="4xx"} 1');
  });

  test("a default app creates an internal registry and /metrics works", async () => {
    const app = createApp(config);
    const res = await app.request("/metrics");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    // The middleware counts requests after the response is produced, so a
    // fresh registry has no series yet.
    expect(await res.text()).toBe("");
  });
});

describe("pseudonymized logging (spec §22.1)", () => {
  test("tenantId is pseudonymized and the raw organization id never appears", async () => {
    const logSpy = vi.spyOn(console, "log");
    const app = createApp(config);

    await app.request("/health", {
      headers: { "x-organization-id": "org-raw-123" },
    });

    const line = logSpy.mock.calls[0]?.[0] as string;
    expect(line).not.toContain("org-raw-123");
    const entry = JSON.parse(line) as Record<string, unknown>;
    expect(entry.tenantId).toMatch(/^[0-9a-f]{12}$/);
    expect(entry.userId).toBeUndefined();
  });

  test("userId is pseudonymized when a session user exists", async () => {
    const logSpy = vi.spyOn(console, "log");
    const app = createApp(config, { auth: makeFakeAuth("user-raw-999") });

    await app.request("/health");

    const line = logSpy.mock.calls[0]?.[0] as string;
    expect(line).not.toContain("user-raw-999");
    const entry = JSON.parse(line) as Record<string, unknown>;
    expect(entry.userId).toMatch(/^[0-9a-f]{12}$/);
  });

  test("no session and no tenant header keep the base log shape", async () => {
    const logSpy = vi.spyOn(console, "log");
    const app = createApp(config);

    await app.request("/health");

    const entry = JSON.parse(logSpy.mock.calls[0]?.[0] as string) as Record<string, unknown>;
    expect(Object.keys(entry)).toHaveLength(9);
    expect(entry.userId).toBeUndefined();
    expect(entry.tenantId).toBeUndefined();
  });
});

describe("tracer wiring (spec §22.3)", () => {
  test("no tracer -> no traceId in the log entry", async () => {
    const logSpy = vi.spyOn(console, "log");
    const app = createApp(config);

    await app.request("/health");

    const entry = JSON.parse(logSpy.mock.calls[0]?.[0] as string) as Record<string, unknown>;
    expect(entry.traceId).toBeUndefined();
  });

  test("createNoopTracer is safe and still records a traceId", async () => {
    const logSpy = vi.spyOn(console, "log");
    const app = createApp(config, { tracer: createNoopTracer() });

    await app.request("/health");

    const entry = JSON.parse(logSpy.mock.calls[0]?.[0] as string) as Record<string, unknown>;
    expect(entry.traceId).toMatch(/^[0-9a-f]{32}$/);
  });

  test("with a fake tracer the span is started and ended and the traceId lands in the log", async () => {
    const spans: Span[] = [];
    const tracer: Tracer = {
      startSpan: (_name) => {
        const span = {
          end: vi.fn(),
          setAttribute: vi.fn(),
          recordError: vi.fn(),
        } as unknown as Span;
        spans.push(span);
        return span;
      },
    };
    const logSpy = vi.spyOn(console, "log");
    const app = createApp(config, { tracer });

    await app.request("/health");

    const entry = JSON.parse(logSpy.mock.calls[0]?.[0] as string) as Record<string, unknown>;
    expect(entry.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(spans).toHaveLength(1);
    expect(spans[0]?.end).toHaveBeenCalledTimes(1);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
