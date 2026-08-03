import type { Config } from "@consulting/config";
import { type LogEntry, levelFromStatus, serializeLog } from "@consulting/core";
import type { MiddlewareHandler } from "hono";

/**
 * Custom structured JSON logger middleware (not hono/logger).
 * Emits one core LogEntry per request on stdout; never logs bodies.
 */
export function jsonLogger(config: Config): MiddlewareHandler {
  return async (c, next) => {
    const start = performance.now();
    await next();
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
    };
    console.log(serializeLog(entry));
  };
}
