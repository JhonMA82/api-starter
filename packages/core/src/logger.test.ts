import { describe, expect, test } from "bun:test";
import type { LogEntry } from "./logger";
import { levelFromStatus, serializeLog } from "./logger";

const sampleEntry: LogEntry = {
  timestamp: "2026-08-02T20:00:00.000Z",
  level: "info",
  service: "@consulting/api",
  environment: "development",
  version: "0.1.0",
  requestId: "req_123",
  route: "GET /health",
  status: 200,
  duration: 3.25,
};

describe("levelFromStatus", () => {
  test("derives info for success", () => {
    expect(levelFromStatus(200)).toBe("info");
    expect(levelFromStatus(301)).toBe("info");
  });

  test("derives warn for 4xx", () => {
    expect(levelFromStatus(400)).toBe("warn");
    expect(levelFromStatus(404)).toBe("warn");
  });

  test("derives error for 5xx", () => {
    expect(levelFromStatus(500)).toBe("error");
    expect(levelFromStatus(503)).toBe("error");
  });
});

describe("serializeLog", () => {
  test("emits all nine fields as one JSON line", () => {
    const line = serializeLog(sampleEntry);
    expect(line.split("\n")).toHaveLength(1);
    const parsed = JSON.parse(line);
    expect(parsed).toEqual(sampleEntry);
    expect(Object.keys(parsed)).toHaveLength(9);
    expect(parsed).toMatchObject({
      timestamp: "2026-08-02T20:00:00.000Z",
      level: "info",
      service: "@consulting/api",
      environment: "development",
      version: "0.1.0",
      requestId: "req_123",
      route: "GET /health",
      status: 200,
      duration: 3.25,
    });
  });

  test("serializes a warn entry with a 4xx status", () => {
    const line = serializeLog({
      ...sampleEntry,
      level: "warn",
      status: 404,
      route: "GET /missing",
    });
    const parsed = JSON.parse(line);
    expect(parsed.level).toBe("warn");
    expect(parsed.status).toBe(404);
  });
});
