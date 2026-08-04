import type { ApiErrorShape, ProblemFieldError } from "./types";

const MAX_SAFE_STRING_LENGTH = 1_024;
const MAX_SAFE_FIELD_ERRORS = 50;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function safeString(value: unknown): string | undefined {
  return typeof value === "string" ? value.slice(0, MAX_SAFE_STRING_LENGTH) : undefined;
}

function safeFieldErrors(value: unknown): readonly ProblemFieldError[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const errors: ProblemFieldError[] = [];
  for (const entry of value.slice(0, MAX_SAFE_FIELD_ERRORS)) {
    if (!isRecord(entry)) {
      continue;
    }
    const field = safeString(entry.field);
    const message = safeString(entry.message);
    if (field !== undefined && message !== undefined) {
      errors.push({ field, message });
    }
  }
  return errors;
}

function toSafeProblem(status: number, value: unknown): ApiErrorShape {
  const source = isRecord(value) ? value : {};
  const code = safeString(source.code) ?? `HTTP_${status}`;
  const requestId = safeString(source.requestId) ?? "";
  const problem: ApiErrorShape = {
    type: safeString(source.type) ?? "about:blank",
    title: safeString(source.title) ?? "Request failed",
    status,
    code,
    requestId,
  };

  const detail = safeString(source.detail);
  if (detail !== undefined) {
    problem.detail = detail;
  }
  const instance = safeString(source.instance);
  if (instance !== undefined) {
    problem.instance = instance;
  }
  const errors = safeFieldErrors(source.errors);
  if (errors !== undefined) {
    problem.errors = errors;
  }
  return problem;
}

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly problem: ApiErrorShape;
  readonly requestId: string | undefined;

  constructor(status: number, problem: ApiErrorShape) {
    super(`API request failed (${status} ${problem.code})`);
    this.name = "ApiClientError";
    this.status = status;
    this.code = problem.code;
    this.problem = problem;
    this.requestId = problem.requestId === "" ? undefined : problem.requestId;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function isApiClientError(error: unknown): error is ApiClientError {
  return error instanceof ApiClientError;
}

/** Builds an error while retaining only bounded, documented problem fields. */
export function createApiClientError(status: number, payload: unknown): ApiClientError {
  return new ApiClientError(status, toSafeProblem(status, payload));
}
