import { describe, expect, test } from "bun:test";

import {
  buildProblemDetails,
  ERROR_CODES,
  mapValidationIssues,
  statusToCode,
  titleFromStatus,
} from "./problem";

describe("titleFromStatus", () => {
  test("derives titles from known statuses", () => {
    expect(titleFromStatus(400)).toBe("Bad Request");
    expect(titleFromStatus(404)).toBe("Not Found");
    expect(titleFromStatus(408)).toBe("Request Timeout");
    expect(titleFromStatus(413)).toBe("Payload Too Large");
    expect(titleFromStatus(500)).toBe("Internal Server Error");
  });

  test("falls back to a generic title for unknown statuses", () => {
    expect(titleFromStatus(503)).toBe("HTTP 503");
  });
});

describe("statusToCode", () => {
  test("maps 400/404 to their codes", () => {
    expect(statusToCode(400)).toBe("VALIDATION_FAILED");
    expect(statusToCode(404)).toBe("NOT_FOUND");
  });

  test("maps 408 and 413 to their codes", () => {
    expect(statusToCode(408)).toBe("REQUEST_TIMEOUT");
    expect(statusToCode(413)).toBe("BODY_TOO_LARGE");
  });

  test("maps everything else to generic INTERNAL_ERROR", () => {
    expect(statusToCode(500)).toBe("INTERNAL_ERROR");
    expect(statusToCode(503)).toBe("INTERNAL_ERROR");
    expect(statusToCode(401)).toBe("INTERNAL_ERROR");
  });
});

describe("buildProblemDetails", () => {
  test("derives title and code from status", () => {
    const problem = buildProblemDetails({ status: 413, requestId: "req_1" });
    expect(problem).toEqual({
      type: "about:blank",
      title: "Payload Too Large",
      status: 413,
      code: "BODY_TOO_LARGE",
      requestId: "req_1",
    });
  });

  test("derives REQUEST_TIMEOUT for 408", () => {
    const problem = buildProblemDetails({ status: 408, requestId: "req_2" });
    expect(problem.code).toBe("REQUEST_TIMEOUT");
    expect(problem.title).toBe("Request Timeout");
  });

  test("allows an explicit code override", () => {
    const problem = buildProblemDetails({
      status: 400,
      code: "VALIDATION_FAILED",
      requestId: "req_3",
      errors: [{ field: "name", message: "Required" }],
    });
    expect(problem.code).toBe("VALIDATION_FAILED");
  });

  test("attaches detail, instance, and errors when provided", () => {
    const problem = buildProblemDetails({
      status: 400,
      requestId: "req_4",
      detail: "Invalid query string",
      instance: "/api/v1/example/hello",
      errors: [{ field: "name", message: "Too short" }],
    });
    expect(problem.detail).toBe("Invalid query string");
    expect(problem.instance).toBe("/api/v1/example/hello");
    expect(problem.errors).toEqual([{ field: "name", message: "Too short" }]);
  });

  test("never includes stack traces or internal details", () => {
    const problem = buildProblemDetails({ status: 500, requestId: "req_5" });
    expect(problem.detail).toBeUndefined();
    expect(JSON.stringify(problem)).not.toMatch(/stack|at \w+ \(|Error:/);
  });
});

describe("mapValidationIssues", () => {
  test("maps issue path to dot-joined field", () => {
    const issues = [
      { path: ["name"], message: "Required" },
      { path: ["user", "email"], message: "Invalid email" },
    ];
    expect(mapValidationIssues(issues)).toEqual([
      { field: "name", message: "Required" },
      { field: "user.email", message: "Invalid email" },
    ]);
  });

  test("handles root-level issues with empty path", () => {
    expect(mapValidationIssues([{ path: [], message: "Invalid input" }])).toEqual([
      { field: "", message: "Invalid input" },
    ]);
  });

  test("handles missing path", () => {
    expect(mapValidationIssues([{ message: "Something went wrong" }])).toEqual([
      { field: "", message: "Something went wrong" },
    ]);
  });
});

describe("ERROR_CODES", () => {
  test("exposes the full catalog", () => {
    expect(ERROR_CODES).toEqual([
      "VALIDATION_FAILED",
      "NOT_FOUND",
      "BODY_TOO_LARGE",
      "REQUEST_TIMEOUT",
      "INTERNAL_ERROR",
    ]);
  });
});
