import { describe, expect, test } from "bun:test";
import { createMetricsRegistry } from "./metrics";

describe("createMetricsRegistry", () => {
  test("counter returns 0 for a name that was never incremented", () => {
    const metrics = createMetricsRegistry();
    expect(metrics.counter("http_requests_total")).toBe(0);
  });

  test("incrementCounter defaults to +1 and accumulates", () => {
    const metrics = createMetricsRegistry();
    metrics.incrementCounter("http_requests_total");
    metrics.incrementCounter("http_requests_total");
    metrics.incrementCounter("http_requests_total", 5);
    expect(metrics.counter("http_requests_total")).toBe(7);
  });

  test("incrementCounter rejects invalid names", () => {
    const metrics = createMetricsRegistry();
    for (const name of ["", "BadName", "1abc", "with space", "has-dash", "UPPER"]) {
      expect(() => metrics.incrementCounter(name)).toThrow();
    }
    metrics.incrementCounter("valid_metric:name_1");
    expect(metrics.counter("valid_metric:name_1")).toBe(1);
  });

  test("incrementCounter rejects negative and non-finite values", () => {
    const metrics = createMetricsRegistry();
    expect(() => metrics.incrementCounter("c", -1)).toThrow();
    expect(() => metrics.incrementCounter("c", Number.NaN)).toThrow();
    expect(() => metrics.incrementCounter("c", Number.POSITIVE_INFINITY)).toThrow();
  });

  test("incrementCounter rejects empty label keys and non-string label values", () => {
    const metrics = createMetricsRegistry();
    expect(() => metrics.incrementCounter("c", 1, { "": "x" })).toThrow();
    expect(() => metrics.incrementCounter("c", 1, { method: 1 as unknown as string })).toThrow();
  });

  test("labeled counters are stored per label set with sorted label keys", () => {
    const metrics = createMetricsRegistry();
    metrics.incrementCounter("http_requests_total", 1, { status_class: "2xx", method: "GET" });
    metrics.incrementCounter("http_requests_total", 1, { method: "GET", status_class: "4xx" });
    expect(metrics.counter("http_requests_total")).toBe(0);
    expect(metrics.counter("http_requests_total", { method: "GET", status_class: "2xx" })).toBe(1);
    expect(metrics.counter("http_requests_total", { status_class: "2xx", method: "GET" })).toBe(1);
  });

  test("histogram tracks count, sum, min, and max", () => {
    const metrics = createMetricsRegistry();
    metrics.histogram("latency", 0.25);
    metrics.histogram("latency", 0.5);
    metrics.histogram("latency", 0.25);
    expect(metrics.snapshot().histograms.latency).toEqual({
      count: 3,
      sum: 1,
      min: 0.25,
      max: 0.5,
    });
  });

  test("histogram rejects non-finite values", () => {
    const metrics = createMetricsRegistry();
    expect(() => metrics.histogram("h", Number.NaN)).toThrow();
    expect(() => metrics.histogram("h", Number.POSITIVE_INFINITY)).toThrow();
  });

  test("gauge sets and overwrites a value", () => {
    const metrics = createMetricsRegistry();
    metrics.gauge("queue_depth", 3);
    expect(metrics.snapshot().gauges.queue_depth).toBe(3);
    metrics.gauge("queue_depth", 1);
    expect(metrics.snapshot().gauges.queue_depth).toBe(1);
    expect(() => metrics.gauge("g", Number.NaN)).toThrow();
  });

  test("snapshot keys use the canonical label form", () => {
    const metrics = createMetricsRegistry();
    metrics.incrementCounter("c", 2, { b: "2", a: "1" });
    expect(metrics.snapshot().counters).toEqual({ 'c{a="1",b="2"}': 2 });
  });

  test("serialize emits sorted TYPE lines and series", () => {
    const metrics = createMetricsRegistry();
    metrics.incrementCounter("http_requests_total", 1, { method: "GET", status_class: "2xx" });
    metrics.histogram("http_request_duration_seconds", 0.002, { method: "GET" });
    metrics.gauge("queue_depth", 2);
    const text = metrics.serialize();
    expect(text).toContain("# TYPE http_request_duration_seconds histogram");
    expect(text).toContain("# TYPE http_requests_total counter");
    expect(text).toContain("# TYPE queue_depth gauge");
    expect(text).toContain('http_requests_total{method="GET",status_class="2xx"} 1');
    expect(text).toContain('http_request_duration_seconds_count{method="GET"} 1');
    expect(text).toContain('http_request_duration_seconds_sum{method="GET"} 0.002');
    expect(text).toContain('http_request_duration_seconds_bucket{method="GET",le="+Inf"} 1');
    expect(text).toContain("queue_depth 2");
    const typeNames = [...text.matchAll(/^# TYPE (\S+) /gm)].map((m) => m[1]);
    expect(typeNames).toEqual([
      "http_request_duration_seconds",
      "http_requests_total",
      "queue_depth",
    ]);
    expect(text.split("\n")).toHaveLength(8);
  });

  test("serialize escapes backslash and quotes in label values", () => {
    const metrics = createMetricsRegistry();
    metrics.incrementCounter("c", 1, { route: 'a"b\\c' });
    expect(metrics.serialize()).toContain('c{route="a\\"b\\\\c"} 1');
  });

  test("serialize of an empty registry is an empty string", () => {
    expect(createMetricsRegistry().serialize()).toBe("");
  });

  test("serialize is stable across calls", () => {
    const metrics = createMetricsRegistry();
    metrics.incrementCounter("a", 1);
    metrics.histogram("h", 1.5);
    metrics.gauge("g", 2);
    expect(metrics.serialize()).toBe(metrics.serialize());
  });
});
