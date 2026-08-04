import type { MetricsRegistry } from "@consulting/core";
import type { MiddlewareHandler } from "hono";

/**
 * Request metrics middleware (spec §22.2): one sample per request with
 * { method, route, status_class } labels. `route` is the matched route
 * pattern (c.req.routePath), keeping label cardinality bounded; unmatched
 * requests fall back to the notFound wildcard "/*".
 */
export function createMetricsMiddleware(registry: MetricsRegistry): MiddlewareHandler {
  return async (c, next) => {
    const start = performance.now();
    await next();
    const labels = {
      method: c.req.method,
      route: c.req.routePath,
      status_class: `${Math.floor(c.res.status / 100)}xx`,
    } as const;
    registry.incrementCounter("http_requests_total", 1, labels);
    registry.histogram("http_request_duration_seconds", (performance.now() - start) / 1000, labels);
    if (c.res.status >= 400) {
      registry.incrementCounter("http_errors_total", 1, labels);
    }
  };
}
