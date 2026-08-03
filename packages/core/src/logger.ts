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
