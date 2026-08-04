import { randomUUID } from "node:crypto";
import type { Config } from "@consulting/config";
import {
  type LogEntry,
  levelFromStatus,
  pseudonymizeId,
  type Span,
  serializeLog,
  type Tracer,
} from "@consulting/core";
import type { MiddlewareHandler } from "hono";

/**
 * Tenant header name; must match ORGANIZATION_ID_HEADER in
 * modules/organizations/src/http/tenant-middleware.ts. Kept as a literal here
 * so this middleware stays importable by generated projects that have no
 * organizations module.
 */
const ORGANIZATION_ID_HEADER = "x-organization-id";

/**
 * Custom structured JSON logger middleware (not hono/logger).
 * Emits one core LogEntry per request on stdout; never logs bodies, emails,
 * or raw ids. When a `tracer` is provided (spec §22.3) a span is started for
 * the request and its generated traceId is attached to the log entry;
 * without a tracer the entry shape is unchanged.
 */
export function jsonLogger(config: Config, tracer?: Tracer): MiddlewareHandler {
  return async (c, next) => {
    const start = performance.now();
    let span: Span | undefined;
    let traceId: string | undefined;
    if (tracer !== undefined) {
      traceId = randomUUID().replaceAll("-", "");
      span = tracer.startSpan(`${c.req.method} ${c.req.routePath}`, { traceId });
    }
    try {
      await next();
    } finally {
      span?.end();
    }
    const user: { id?: string } | null = c.get("user");
    const userId = pseudonymizeId(user?.id);
    const tenantId = pseudonymizeId(c.req.header(ORGANIZATION_ID_HEADER));
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: levelFromStatus(c.res.status),
      service: "@consulting/api",
      environment: config.APP_ENV,
      version: config.APP_VERSION,
      requestId: c.get("requestId"),
      route: `${c.req.method} ${c.req.routePath}`,
      status: c.res.status,
      duration: performance.now() - start,
      ...(userId === undefined ? {} : { userId }),
      ...(tenantId === undefined ? {} : { tenantId }),
      ...(traceId === undefined ? {} : { traceId }),
    };
    console.log(serializeLog(entry));
  };
}
