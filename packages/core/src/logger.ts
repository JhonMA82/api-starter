import { createHash } from "node:crypto";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  service: string;
  environment: string;
  version: string;
  requestId: string;
  route: string;
  status: number;
  duration: number;
  /** Pseudonymized actor id (sha256 hex prefix) — never the raw user id. */
  userId?: string;
  /** Pseudonymized tenant id (sha256 hex prefix) — never the raw org id. */
  tenantId?: string;
  /** Trace id when a tracer is wired (§22.3); absent otherwise. */
  traceId?: string;
}

/**
 * Pseudonymizes an id for logging (spec §22.1): sha256 hex truncated to 12
 * chars, stable per input. Returns undefined for empty/missing input so the
 * optional LogEntry fields are simply omitted. Raw ids never reach logs.
 */
export function pseudonymizeId(id: string | undefined): string | undefined {
  if (id === undefined || id === "") {
    return undefined;
  }
  return createHash("sha256").update(id).digest("hex").slice(0, 12);
}

export function levelFromStatus(status: number): LogLevel {
  if (status >= 500) {
    return "error";
  }
  if (status >= 400) {
    return "warn";
  }
  return "info";
}

export function serializeLog(entry: LogEntry): string {
  return JSON.stringify(entry);
}
