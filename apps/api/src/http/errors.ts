import { type BuildProblemDetailsInput, buildProblemDetails } from "@consulting/core";
import type { ErrorHandler, NotFoundHandler } from "hono";
import { HTTPException } from "hono/http-exception";

const PROBLEM_JSON = { "content-type": "application/problem+json" } as const;

export const notFound: NotFoundHandler = (c) => {
  const problem = buildProblemDetails({
    status: 404,
    code: "NOT_FOUND",
    requestId: c.get("requestId"),
    instance: c.req.path,
  });
  return c.json(problem, 404, PROBLEM_JSON);
};

/**
 * Error normalization: HTTPException status -> problem code (413 -> BODY_TOO_LARGE,
 * 408 -> REQUEST_TIMEOUT, ...), anything else -> 500 INTERNAL_ERROR with a generic
 * detail. Never leaks stack traces or internals.
 */
export const onError: ErrorHandler = (error, c) => {
  const status = error instanceof HTTPException ? error.status : 500;
  const input: BuildProblemDetailsInput = {
    status,
    requestId: c.get("requestId"),
    instance: c.req.path,
  };
  if (status === 500) {
    input.detail = "An unexpected internal error occurred";
  }
  return c.json(buildProblemDetails(input), status, PROBLEM_JSON);
};
