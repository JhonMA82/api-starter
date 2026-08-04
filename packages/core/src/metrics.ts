/**
 * Dependency-free metrics registry (spec §22.2): counters, gauges, and
 * histograms with a Prometheus-text-compatible serialization. No external
 * dependencies — the registry is a plain in-memory store that a future
 * provider (e.g. OpenTelemetry) could back without changing callers.
 */

export type MetricLabels = Readonly<Record<string, string>>;

export interface HistogramSummary {
  count: number;
  sum: number;
  min?: number;
  max?: number;
}

/**
 * Point-in-time snapshot of every tracked metric. Keys use the canonical
 * form `name` for unlabeled metrics and `name{label="value",...}` (labels
 * sorted, values escaped) for labeled ones — the same key format emitted by
 * serialize(), so snapshots and the text output stay consistent.
 */
export interface MetricSnapshot {
  counters: Record<string, number>;
  gauges: Record<string, number>;
  histograms: Record<string, HistogramSummary>;
}

export interface MetricsRegistry {
  /** Current counter value; 0 when the counter has never been incremented. */
  counter(name: string, labels?: MetricLabels): number;
  /** Adds `value` (default 1) to a counter; value must be finite and >= 0. */
  incrementCounter(name: string, value?: number, labels?: MetricLabels): void;
  /** Records one observation into a histogram; value must be finite. */
  histogram(name: string, value: number, labels?: MetricLabels): void;
  /** Sets a gauge to `value` (overwrites); value must be finite. */
  gauge(name: string, value: number, labels?: MetricLabels): void;
  snapshot(): MetricSnapshot;
  /** Prometheus text exposition format (version 0.0.4). */
  serialize(): string;
}

const NAME_PATTERN = /^[a-z][a-z0-9_:]*$/;

function assertMetricName(name: string): void {
  if (typeof name !== "string" || !NAME_PATTERN.test(name)) {
    throw new Error(`invalid metric name "${String(name)}": expected /^[a-z][a-z0-9_:]*$/`);
  }
}

function assertFinite(value: number, what: string): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${what} must be a finite number, got ${String(value)}`);
  }
}

function assertNonNegative(value: number): void {
  assertFinite(value, "counter increment");
  if (value < 0) {
    throw new Error(`counter increment must be >= 0, got ${value}`);
  }
}

/**
 * Validates label keys/values and returns them sorted by key for stable
 * output. Keys must be non-empty strings and values must be strings.
 */
function normalizeLabels(labels: MetricLabels | undefined): Array<[string, string]> | undefined {
  if (labels === undefined) {
    return undefined;
  }
  const entries = Object.entries(labels);
  for (const [key, value] of entries) {
    if (key === "") {
      throw new Error("metric label keys must not be empty");
    }
    if (typeof value !== "string") {
      throw new Error(`metric label "${key}" must be a string, got ${String(value)}`);
    }
  }
  entries.sort(([a], [b]) => a.localeCompare(b));
  return entries;
}

function escapeLabelValue(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\n");
}

/** Canonical storage/snapshot key: `name` or `name{k="v",...}`. */
function canonicalKey(name: string, entries: Array<[string, string]> | undefined): string {
  if (entries === undefined) {
    return name;
  }
  const labels = entries.map(([key, value]) => `${key}="${escapeLabelValue(value)}"`).join(",");
  return `${name}{${labels}}`;
}

function baseNameOf(key: string): string {
  const brace = key.indexOf("{");
  return brace === -1 ? key : key.slice(0, brace);
}

function labelPartOf(key: string): string {
  const brace = key.indexOf("{");
  return brace === -1 ? "" : key.slice(brace);
}

export function createMetricsRegistry(): MetricsRegistry {
  const counters = new Map<string, number>();
  const gauges = new Map<string, number>();
  const histograms = new Map<string, HistogramSummary>();

  function keyFor(name: string, labels: MetricLabels | undefined): string {
    assertMetricName(name);
    return canonicalKey(name, normalizeLabels(labels));
  }

  function takeSnapshot(): MetricSnapshot {
    const sortEntries = <T>(entries: Iterable<[string, T]>) =>
      [...entries].sort(([a], [b]) => a.localeCompare(b));
    return {
      counters: Object.fromEntries(sortEntries(counters.entries())),
      gauges: Object.fromEntries(sortEntries(gauges.entries())),
      histograms: Object.fromEntries(
        sortEntries(histograms.entries()).map(([key, value]) => [key, { ...value }]),
      ),
    };
  }

  return {
    counter(name, labels) {
      return counters.get(keyFor(name, labels)) ?? 0;
    },

    incrementCounter(name, value = 1, labels) {
      assertNonNegative(value);
      const key = keyFor(name, labels);
      counters.set(key, (counters.get(key) ?? 0) + value);
    },

    histogram(name, value, labels) {
      assertFinite(value, "histogram observation");
      const key = keyFor(name, labels);
      const current = histograms.get(key) ?? { count: 0, sum: 0 };
      current.count += 1;
      current.sum += value;
      current.min = current.min === undefined ? value : Math.min(current.min, value);
      current.max = current.max === undefined ? value : Math.max(current.max, value);
      histograms.set(key, current);
    },

    gauge(name, value, labels) {
      assertFinite(value, "gauge value");
      gauges.set(keyFor(name, labels), value);
    },

    snapshot() {
      return takeSnapshot();
    },

    serialize() {
      const snapshot = takeSnapshot();
      const series: Array<{
        name: string;
        type: "counter" | "gauge" | "histogram";
        key: string;
        line: string;
      }> = [];

      for (const [key, value] of Object.entries(snapshot.counters)) {
        series.push({ name: baseNameOf(key), type: "counter", key, line: `${key} ${value}` });
      }
      for (const [key, value] of Object.entries(snapshot.gauges)) {
        series.push({ name: baseNameOf(key), type: "gauge", key, line: `${key} ${value}` });
      }
      for (const [key, summary] of Object.entries(snapshot.histograms)) {
        const name = baseNameOf(key);
        const labels = labelPartOf(key);
        series.push({
          name,
          type: "histogram",
          key: `${name}_count${labels}`,
          line: `${name}_count${labels} ${summary.count}`,
        });
        series.push({
          name,
          type: "histogram",
          key: `${name}_sum${labels}`,
          line: `${name}_sum${labels} ${summary.sum}`,
        });
        const bucketLabels = labels === "" ? `{le="+Inf"}` : `${labels.slice(0, -1)},le="+Inf"}`;
        series.push({
          name,
          type: "histogram",
          key: `${name}_bucket${labels}`,
          line: `${name}_bucket${bucketLabels} ${summary.count}`,
        });
      }

      const types = new Map<string, "counter" | "gauge" | "histogram">();
      for (const entry of series) {
        if (!types.has(entry.name)) {
          types.set(entry.name, entry.type);
        }
      }
      const typeLines = [...types.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, type]) => `# TYPE ${name} ${type}`);
      const seriesLines = series.sort((a, b) => a.key.localeCompare(b.key)).map((s) => s.line);

      return [...typeLines, ...seriesLines].join("\n");
    },
  };
}
