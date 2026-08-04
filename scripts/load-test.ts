import { writeFile } from "node:fs/promises";

/**
 * Dependency-free load generator for the API starter, using only the
 * standard Bun runtime (fetch, AbortSignal, performance). It is a
 * smoke/regression harness, NOT a substitute for dedicated load-testing
 * tooling (see docs/load-test.md).
 */

export const MAX_DURATION_SECONDS = 120;
export const MAX_CONCURRENCY = 200;
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export interface LoadTestOptions {
  url: string;
  path: string;
  durationSeconds: number;
  concurrency: number;
  /** Optional approximate request rate cap (requests/second). */
  rate?: number;
  /** Per-request timeout (ms); guards against hung connections. */
  requestTimeoutMs?: number;
}

export interface LatencySummary {
  min: number;
  mean: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
  max: number;
}

export interface LoadSummary {
  url: string;
  path: string;
  durationSeconds: number;
  concurrency: number;
  rate: number | null;
  total: number;
  successes: number;
  errors: number;
  statusCounts: Record<string, number>;
  latencies: LatencySummary;
  requestsPerSecond: number;
}

/** A recorded request: latency (ms) and outcome. Errors carry status null. */
export interface Sample {
  latencyMs: number;
  status: number | null;
  error: boolean;
}

export interface ParsedArgs {
  url: string;
  path: string;
  durationSeconds: number;
  concurrency: number;
  rate: number | null;
  summaryFile: string | null;
  help: boolean;
}

const round1 = (v: number): number => Math.round(v * 10) / 10;

/**
 * Linear-interpolation percentile over a SORTED ascending array.
 * percentile(v, 0) === v[0], percentile(v, 100) === v[v.length - 1];
 * empty input yields 0.
 */
export function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) {
    return 0;
  }
  if (sortedValues.length === 1) {
    return sortedValues[0] ?? 0;
  }
  const rank = (p / 100) * (sortedValues.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  const weight = rank - lower;
  const a = sortedValues[lower] ?? 0;
  const b = sortedValues[upper] ?? a;
  return round1(a * (1 - weight) + b * weight);
}

function latencySummary(latencies: number[]): LatencySummary {
  if (latencies.length === 0) {
    return { min: 0, mean: 0, p50: 0, p90: 0, p95: 0, p99: 0, max: 0 };
  }
  const sorted = [...latencies].sort((a, b) => a - b);
  const min = sorted[0] ?? 0;
  const max = sorted[sorted.length - 1] ?? 0;
  const mean = latencies.reduce((sum, v) => sum + v, 0) / latencies.length;
  return {
    min,
    mean: round1(mean),
    p50: percentile(sorted, 50),
    p90: percentile(sorted, 90),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max,
  };
}

/**
 * Aggregates recorded samples into a LoadSummary. Latency statistics cover
 * completed (non-error) requests only; network/timeout errors are counted in
 * `errors` and never distort latency percentiles.
 */
export function aggregateResults(samples: Sample[], options: LoadTestOptions): LoadSummary {
  const total = samples.length;
  let successes = 0;
  let errors = 0;
  const statusCounts: Record<string, number> = {};
  const latencies: number[] = [];
  for (const sample of samples) {
    if (sample.error) {
      errors += 1;
      continue;
    }
    if (sample.status !== null) {
      const key = String(sample.status);
      statusCounts[key] = (statusCounts[key] ?? 0) + 1;
      if (sample.status >= 200 && sample.status < 300) {
        successes += 1;
      }
    }
    latencies.push(sample.latencyMs);
  }
  return {
    url: options.url,
    path: options.path,
    durationSeconds: options.durationSeconds,
    concurrency: options.concurrency,
    rate: options.rate ?? null,
    total,
    successes,
    errors,
    statusCounts,
    latencies: latencySummary(latencies),
    requestsPerSecond: round1(total / options.durationSeconds),
  };
}

function clampInt(value: number, min: number, max: number, name: string): number {
  if (Number.isNaN(value)) {
    throw new TypeError(`[load-test] ${name} must be a number`);
  }
  if (value < min || value > max) {
    console.warn(`[load-test] ${name} ${value} out of range [${min}, ${max}]; clamping`);
    return Math.min(Math.max(Math.round(value), min), max);
  }
  return Math.round(value);
}

/** Validates and normalizes options. Throws on malformed input. */
export function normalizeOptions(raw: LoadTestOptions): LoadTestOptions {
  if (!/^https?:\/\//.test(raw.url)) {
    throw new Error(`[load-test] invalid --url: ${raw.url} (must start with http:// or https://)`);
  }
  if (raw.path.length === 0 || !raw.path.startsWith("/")) {
    throw new Error(`[load-test] invalid --path: ${raw.path} (must start with "/")`);
  }
  const durationSeconds = clampInt(raw.durationSeconds, 1, MAX_DURATION_SECONDS, "duration");
  const concurrency = clampInt(raw.concurrency, 1, MAX_CONCURRENCY, "concurrency");
  const requestTimeoutMs =
    raw.requestTimeoutMs === undefined
      ? DEFAULT_REQUEST_TIMEOUT_MS
      : clampInt(raw.requestTimeoutMs, 100, 120_000, "request-timeout");
  const options: LoadTestOptions = {
    url: raw.url.replace(/\/+$/, ""),
    path: raw.path,
    durationSeconds,
    concurrency,
    requestTimeoutMs,
  };
  if (raw.rate !== undefined) {
    if (raw.rate <= 0) {
      throw new Error(`[load-test] invalid --rate: ${raw.rate} (must be > 0)`);
    }
    options.rate = raw.rate;
  }
  return options;
}

/** Parses CLI argv; supports both --key=value and --key value forms. */
export function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    url: "http://localhost:3000",
    path: "/health",
    durationSeconds: 10,
    concurrency: 10,
    rate: null,
    summaryFile: null,
    help: false,
  };
  const KEY_VALUE_KEYS = new Set(["url", "path", "summary"]);
  const NUMERIC_KEYS = new Set(["duration", "concurrency", "rate"]);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? "";
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }
    if (!arg.startsWith("--")) {
      throw new Error(`[load-test] unknown argument: ${arg}`);
    }
    const eq = arg.indexOf("=");
    const key = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    let value = eq === -1 ? null : arg.slice(eq + 1);
    if (value === null) {
      value = argv[i + 1] ?? "";
      if (value.startsWith("--")) {
        throw new Error(`[load-test] missing value for --${key}`);
      }
      i += 1;
    }
    if (KEY_VALUE_KEYS.has(key)) {
      if (value === "") {
        throw new Error(`[load-test] empty value for --${key}`);
      }
      if (key === "url") {
        parsed.url = value;
      } else if (key === "path") {
        parsed.path = value;
      } else {
        parsed.summaryFile = value;
      }
    } else if (NUMERIC_KEYS.has(key)) {
      if (value === "") {
        throw new Error(`[load-test] missing value for --${key}`);
      }
      const num = Number(value);
      if (Number.isNaN(num)) {
        throw new Error(`[load-test] --${key} must be a number, got "${value}"`);
      }
      if (key === "duration") {
        parsed.durationSeconds = num;
      } else if (key === "concurrency") {
        parsed.concurrency = num;
      } else {
        parsed.rate = num;
      }
    } else {
      throw new Error(`[load-test] unknown argument: --${key}`);
    }
  }
  return parsed;
}

function usage(): string {
  return [
    "Usage: bun scripts/load-test.ts [options]",
    "",
    "Options:",
    "  --url=<base>          Base URL (default: http://localhost:3000)",
    "  --path=<path>         Path to hit, e.g. /health or /api/v1/example/hello?name=load",
    "                        (default: /health)",
    "  --duration=<seconds>  Run duration (default: 10, max: 120)",
    "  --concurrency=<n>     Concurrent workers (default: 10, max: 200)",
    "  --rate=<n>            Optional approximate requests/second cap (default: unlimited)",
    "  --summary=<file>      Write JSON summary to <file>",
    "  --help                Show this help",
  ].join("\n");
}

function printSummary(summary: LoadSummary): void {
  const rate = summary.rate === null ? "unlimited" : String(summary.rate);
  const successPct =
    summary.total === 0 ? "0.0%" : `${((summary.successes / summary.total) * 100).toFixed(1)}%`;
  console.log("");
  console.log("[load-test] summary");
  console.log(`[load-test]   target:       ${summary.url}${summary.path}`);
  console.log(
    `[load-test]   duration:     ${summary.durationSeconds}s (concurrency ${summary.concurrency}, rate ${rate})`,
  );
  console.log(`[load-test]   requests:     ${summary.total} (${summary.requestsPerSecond} req/s)`);
  console.log(`[load-test]   successes:    ${summary.successes} (${successPct})`);
  console.log(`[load-test]   errors:       ${summary.errors}`);
  const statuses = Object.entries(summary.statusCounts)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([status, count]) => `${status}: ${count}`)
    .join(", ");
  console.log(`[load-test]   statuses:     ${statuses === "" ? "(none)" : statuses}`);
  const l = summary.latencies;
  console.log(
    `[load-test]   latency (ms): min ${l.min}, mean ${l.mean}, p50 ${l.p50}, p90 ${l.p90}, p95 ${l.p95}, p99 ${l.p99}, max ${l.max}`,
  );
}

/**
 * Runs the load test: one warmup request, then `concurrency` workers
 * hammering `path` until the duration elapses.
 */
export async function runLoadTest(rawOptions: LoadTestOptions): Promise<LoadSummary> {
  const options = normalizeOptions(rawOptions);
  const target = `${options.url}${options.path}`;

  let warmup: Response;
  try {
    warmup = await fetch(target, {
      signal: AbortSignal.timeout(5_000),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`[load-test] server not reachable at ${target}: ${reason}`);
  }
  if (!warmup.ok) {
    throw new Error(`[load-test] warmup request to ${target} failed with status ${warmup.status}`);
  }

  const samples: Sample[] = [];
  const startAt = performance.now();
  const endAt = startAt + options.durationSeconds * 1000;
  const timeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;

  // Approximate global rate gate: no more than `rate` request starts per
  // second, shared across all workers. Bun's single-threaded event loop
  // makes the shared counter race-free in practice.
  let lastRequestStartAt = startAt;
  async function rateGate(): Promise<void> {
    const rate = options.rate;
    if (rate === undefined) {
      return;
    }
    const intervalMs = 1000 / rate;
    let waitMs = lastRequestStartAt + intervalMs - performance.now();
    while (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      waitMs = lastRequestStartAt + intervalMs - performance.now();
    }
    lastRequestStartAt = performance.now();
  }

  async function worker(): Promise<void> {
    while (performance.now() < endAt) {
      await rateGate();
      if (performance.now() >= endAt) {
        break;
      }
      const startedAt = performance.now();
      try {
        const response = await fetch(target, { signal: AbortSignal.timeout(timeoutMs) });
        samples.push({
          latencyMs: round1(performance.now() - startedAt),
          status: response.status,
          error: false,
        });
      } catch {
        samples.push({
          latencyMs: round1(performance.now() - startedAt),
          status: null,
          error: true,
        });
      }
    }
  }

  const workers: Promise<void>[] = [];
  for (let i = 0; i < options.concurrency; i += 1) {
    workers.push(worker());
  }
  await Promise.all(workers);

  return aggregateResults(samples, options);
}

async function main(): Promise<void> {
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage());
    process.exit(1);
  }
  if (parsed.help) {
    console.log(usage());
    process.exit(0);
  }

  try {
    const summary = await runLoadTest({
      url: parsed.url,
      path: parsed.path,
      durationSeconds: parsed.durationSeconds,
      concurrency: parsed.concurrency,
      ...(parsed.rate === null ? {} : { rate: parsed.rate }),
    });
    printSummary(summary);
    if (parsed.summaryFile !== null) {
      await writeFile(parsed.summaryFile, `${JSON.stringify(summary, null, 2)}\n`);
      console.log(`[load-test] summary written to ${parsed.summaryFile}`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (import.meta.main) {
  void main();
}
