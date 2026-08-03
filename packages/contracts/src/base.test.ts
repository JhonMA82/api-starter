import { describe, expect, test } from "bun:test";

import { HealthResponse, ReadyResponse, VersionResponse } from "./base";
import type { ProblemDetails } from "./problem";
import { ProblemDetailsSchema } from "./problem";

describe("HealthResponse", () => {
  test("parses the ok status", () => {
    expect(HealthResponse.parse({ status: "ok" })).toEqual({ status: "ok" });
  });

  test("rejects other statuses", () => {
    expect(() => HealthResponse.parse({ status: "ready" })).toThrow();
  });
});

describe("ReadyResponse", () => {
  test("parses with default empty checks", () => {
    expect(ReadyResponse.parse({ status: "ready" })).toEqual({ status: "ready", checks: {} });
  });

  test("parses a checks map", () => {
    expect(ReadyResponse.parse({ status: "ready", checks: { db: "ok" } })).toEqual({
      status: "ready",
      checks: { db: "ok" },
    });
  });
});

describe("VersionResponse", () => {
  test("parses a valid payload", () => {
    expect(
      VersionResponse.parse({
        name: "@consulting/api",
        version: "0.1.0",
        environment: "development",
      }),
    ).toEqual({ name: "@consulting/api", version: "0.1.0", environment: "development" });
  });

  test("rejects an invalid environment", () => {
    expect(() =>
      VersionResponse.parse({ name: "@consulting/api", version: "0.1.0", environment: "prod" }),
    ).toThrow();
  });
});

describe("ProblemDetailsSchema", () => {
  test("parses a representative valid problem", () => {
    const problem: ProblemDetails = {
      type: "about:blank",
      title: "Not Found",
      status: 404,
      code: "NOT_FOUND",
      instance: "/missing",
      requestId: "req_1",
    };
    expect(ProblemDetailsSchema.parse(problem)).toEqual(problem);
  });

  test("parses a validation problem with errors array", () => {
    const problem: ProblemDetails = {
      type: "about:blank",
      title: "Bad Request",
      status: 400,
      code: "VALIDATION_FAILED",
      requestId: "req_2",
      errors: [{ field: "name", message: "Required" }],
    };
    expect(ProblemDetailsSchema.parse(problem)).toEqual(problem);
  });

  test("rejects an unknown error code", () => {
    expect(() =>
      ProblemDetailsSchema.parse({
        type: "about:blank",
        title: "Oops",
        status: 500,
        code: "NOPE",
        requestId: "req_3",
      }),
    ).toThrow(/code/);
  });

  test("rejects a non-integer status", () => {
    expect(() =>
      ProblemDetailsSchema.parse({
        type: "about:blank",
        title: "Oops",
        status: 400.5,
        code: "VALIDATION_FAILED",
        requestId: "req_4",
      }),
    ).toThrow();
  });
});
