import { describe, expect, test } from "bun:test";
import type { LogEntry } from "./logger";
import { levelFromStatus, pseudonymizeId, serializeLog } from "./logger";

const sampleEntry: LogEntry = {
  timestamp: "2026-08-02T20:00:00.000Z",
  level: "info",
  service: "@consulting/api",
  environment: "development",
  version: "0.10.1",
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

describe("pseudonymizeId", () => {
  test("returns a stable 12-char sha256 hex prefix per input", () => {
    const first = pseudonymizeId("user-123");
    expect(first).toMatch(/^[0-9a-f]{12}$/);
    expect(pseudonymizeId("user-123")).toBe(first);
    expect(pseudonymizeId("user-123")).not.toBe(pseudonymizeId("user-124"));
  });

  test("returns undefined for empty or missing input", () => {
    expect(pseudonymizeId("")).toBeUndefined();
    expect(pseudonymizeId(undefined)).toBeUndefined();
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
      version: "0.10.1",
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
