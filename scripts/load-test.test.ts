import { describe, expect, test } from "bun:test";
import {
  aggregateResults,
  type LoadSummary,
  type LoadTestOptions,
  normalizeOptions,
  parseArgs,
  percentile,
  runLoadTest,
} from "./load-test";

function options(overrides: Partial<LoadTestOptions> = {}): LoadTestOptions {
  return {
    url: "http://localhost:3000",
    path: "/health",
    durationSeconds: 1,
    concurrency: 1,
    ...overrides,
  };
}

describe("percentile", () => {
  test("linear interpolation over sorted values", () => {
    const sorted = [10, 20, 30, 40, 50];
    expect(percentile(sorted, 0)).toBe(10);
    expect(percentile(sorted, 50)).toBe(30);
    expect(percentile(sorted, 90)).toBe(46);
    expect(percentile(sorted, 95)).toBe(48);
    expect(percentile(sorted, 99)).toBe(49.6);
    expect(percentile(sorted, 100)).toBe(50);
  });

  test("single value and empty input", () => {
    expect(percentile([7], 99)).toBe(7);
    expect(percentile([], 50)).toBe(0);
  });

  test("median of even-length array", () => {
    expect(percentile([1, 2, 3, 4], 50)).toBe(2.5);
  });
});

describe("aggregateResults", () => {
  test("counts statuses, successes and errors", () => {
    const summary = aggregateResults(
      [
        { latencyMs: 10, status: 200, error: false },
        { latencyMs: 20, status: 200, error: false },
        { latencyMs: 30, status: 201, error: false },
        { latencyMs: 40, status: 404, error: false },
        { latencyMs: 5000, status: null, error: true },
      ],
      options(),
    );
    expect(summary.total).toBe(5);
    expect(summary.successes).toBe(3);
    expect(summary.errors).toBe(1);
    expect(summary.statusCounts).toEqual({ "200": 2, "201": 1, "404": 1 });
    expect(summary.rate).toBeNull();
  });

  test("latency stats only cover completed requests", () => {
    const summary = aggregateResults(
      [
        { latencyMs: 1, status: 200, error: false },
        { latencyMs: 2, status: 200, error: false },
        { latencyMs: 3, status: 200, error: false },
        { latencyMs: 4, status: 200, error: false },
        { latencyMs: 30_000, status: null, error: true },
      ],
      options(),
    );
    expect(summary.latencies.min).toBe(1);
    expect(summary.latencies.max).toBe(4);
    expect(summary.latencies.p50).toBe(2.5);
    expect(summary.latencies.p99).toBeGreaterThan(3.5);
    expect(summary.latencies.p99).toBeLessThanOrEqual(4);
  });

  test("latency bounds: p50 within [min, max]", () => {
    const summary = aggregateResults(
      Array.from({ length: 100 }, (_, i) => ({ latencyMs: i + 1, status: 200, error: false })),
      options(),
    );
    const l = summary.latencies;
    expect(l.min).toBe(1);
    expect(l.max).toBe(100);
    expect(l.p50).toBeGreaterThanOrEqual(l.min);
    expect(l.p50).toBeLessThanOrEqual(l.max);
    expect(l.p95).toBeGreaterThanOrEqual(l.p50);
    expect(l.p99).toBeGreaterThanOrEqual(l.p95);
  });

  test("empty input yields zeroed summary", () => {
    const summary = aggregateResults([], options());
    expect(summary.total).toBe(0);
    expect(summary.successes).toBe(0);
    expect(summary.errors).toBe(0);
    expect(summary.statusCounts).toEqual({});
    expect(summary.latencies).toEqual({ min: 0, mean: 0, p50: 0, p90: 0, p95: 0, p99: 0, max: 0 });
    expect(summary.requestsPerSecond).toBe(0);
  });

  test("produces the documented JSON shape", () => {
    const summary = aggregateResults(
      [{ latencyMs: 5, status: 200, error: false }],
      options({ rate: 10 }),
    );
    expect(Object.keys(summary).sort()).toEqual([
      "concurrency",
      "durationSeconds",
      "errors",
      "latencies",
      "path",
      "rate",
      "requestsPerSecond",
      "statusCounts",
      "successes",
      "total",
      "url",
    ]);
    expect(summary.rate).toBe(10);
    expect(summary.requestsPerSecond).toBe(1);
  });
});

describe("parseArgs", () => {
  test("defaults", () => {
    const parsed = parseArgs([]);
    expect(parsed).toEqual({
      url: "http://localhost:3000",
      path: "/health",
      durationSeconds: 10,
      concurrency: 10,
      rate: null,
      summaryFile: null,
      help: false,
    });
  });

  test("both --key=value and --key value forms", () => {
    const parsed = parseArgs([
      "--url=http://localhost:8080",
      "--duration",
      "5",
      "--concurrency=20",
      "--path",
      "/api/v1/example/hello?name=load",
      "--rate=50",
      "--summary=/tmp/load.json",
    ]);
    expect(parsed.url).toBe("http://localhost:8080");
    expect(parsed.durationSeconds).toBe(5);
    expect(parsed.concurrency).toBe(20);
    expect(parsed.path).toBe("/api/v1/example/hello?name=load");
    expect(parsed.rate).toBe(50);
    expect(parsed.summaryFile).toBe("/tmp/load.json");
  });

  test("rejects unknown flags and non-numeric values", () => {
    expect(() => parseArgs(["--nope"])).toThrow(/unknown argument/);
    expect(() => parseArgs(["--duration=abc"])).toThrow(/must be a number/);
    expect(() => parseArgs(["--rate"])).toThrow(/missing value/);
  });
});

describe("normalizeOptions", () => {
  test("clamps duration and concurrency", () => {
    const normalized = normalizeOptions(options({ durationSeconds: 500, concurrency: 999 }));
    expect(normalized.durationSeconds).toBe(120);
    expect(normalized.concurrency).toBe(200);
    expect(normalized.rate).toBeUndefined();
  });

  test("rejects malformed url and path", () => {
    expect(() => normalizeOptions(options({ url: "localhost:3000" }))).toThrow(/--url/);
    expect(() => normalizeOptions(options({ path: "health" }))).toThrow(/--path/);
  });
});

describe("runLoadTest (integration)", () => {
  test("hits a local server and returns a valid summary", async () => {
    const server = Bun.serve({
      port: 0,
      fetch: (request) => {
        const url = new URL(request.url);
        if (url.pathname === "/slow") {
          return new Promise((resolve) => {
            setTimeout(() => resolve(new Response("slow ok", { status: 200 })), 50);
          });
        }
        return new Response(JSON.stringify({ status: "ok" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });
    try {
      const baseUrl = `http://localhost:${server.port}`;
      const summary: LoadSummary = await runLoadTest({
        url: baseUrl,
        path: "/health",
        durationSeconds: 1,
        concurrency: 3,
      });
      expect(summary.total).toBeGreaterThan(0);
      expect(summary.successes).toBe(summary.total);
      expect(summary.errors).toBe(0);
      expect(summary.statusCounts["200"]).toBe(summary.total);
      expect(summary.requestsPerSecond).toBeGreaterThan(0);
      expect(summary.latencies.max).toBeGreaterThanOrEqual(summary.latencies.min);

      const slow: LoadSummary = await runLoadTest({
        url: baseUrl,
        path: "/slow",
        durationSeconds: 1,
        concurrency: 3,
      });
      expect(slow.total).toBeGreaterThan(0);
      expect(slow.successes).toBe(slow.total);
      expect(slow.latencies.p50).toBeGreaterThanOrEqual(40);
    } finally {
      server.stop(true);
    }
  });

  test("fails fast when the server is unreachable", async () => {
    await expect(
      runLoadTest({
        url: "http://localhost:1",
        path: "/health",
        durationSeconds: 1,
        concurrency: 1,
      }),
    ).rejects.toThrow(/not reachable/i);
  });
});
