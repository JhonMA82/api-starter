/**
 * Decoupled tracing contract (spec §22.3). The API never depends on a
 * specific tracing provider: `Tracer`/`Span` are the only surface it talks
 * to, and `createNoopTracer()` is the safe default. A provider adapter
 * (e.g. OpenTelemetry) can implement this interface later and be injected
 * through `createApp` without any change to the core packages.
 */

export interface Span {
  end(): void;
  setAttribute(key: string, value: string): void;
  recordError(error: Error): void;
}

export interface TracerStartContext {
  traceId?: string;
  parentSpanId?: string;
  attributes?: Record<string, string>;
}

export interface Tracer {
  startSpan(name: string, context?: TracerStartContext): Span;
}

/** No-op tracer: safe default that records nothing and never throws. */
export function createNoopTracer(): Tracer {
  return {
    startSpan() {
      return {
        end() {},
        setAttribute() {},
        recordError() {},
      };
    },
  };
}
