export const ERROR_CODES = [
  "VALIDATION_FAILED",
  "NOT_FOUND",
  "BODY_TOO_LARGE",
  "REQUEST_TIMEOUT",
  "INTERNAL_ERROR",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "CONFLICT",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface FieldError {
  field: string;
  message: string;
}

export interface ProblemDetails {
  type: "about:blank";
  title: string;
  status: number;
  code: ErrorCode;
  detail?: string;
  instance?: string;
  requestId: string;
  errors?: FieldError[];
}

export interface BuildProblemDetailsInput {
  status: number;
  code?: ErrorCode;
  detail?: string;
  instance?: string;
  requestId: string;
  errors?: FieldError[];
}

const TITLES: Record<number, string> = {
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  408: "Request Timeout",
  409: "Conflict",
  413: "Payload Too Large",
  500: "Internal Server Error",
};

export function titleFromStatus(status: number): string {
  return TITLES[status] ?? `HTTP ${status}`;
}

export function statusToCode(status: number): ErrorCode {
  switch (status) {
    case 400:
      return "VALIDATION_FAILED";
    case 401:
      return "UNAUTHORIZED";
    case 403:
      return "FORBIDDEN";
    case 404:
      return "NOT_FOUND";
    case 408:
      return "REQUEST_TIMEOUT";
    case 409:
      return "CONFLICT";
    case 413:
      return "BODY_TOO_LARGE";
    default:
      return "INTERNAL_ERROR";
  }
}

export function buildProblemDetails(input: BuildProblemDetailsInput): ProblemDetails {
  const problem: ProblemDetails = {
    type: "about:blank",
    title: titleFromStatus(input.status),
    status: input.status,
    code: input.code ?? statusToCode(input.status),
    requestId: input.requestId,
  };
  if (input.detail !== undefined) {
    problem.detail = input.detail;
  }
  if (input.instance !== undefined) {
    problem.instance = input.instance;
  }
  if (input.errors !== undefined) {
    problem.errors = input.errors;
  }
  return problem;
}

/**
 * Standard Schema path segment (spec >= 1.0): an object-wrapped key.
 * Kept structural so core stays dependency-free.
 */
export interface PathSegment {
  readonly key: string | number | symbol;
}

export interface ValidationIssue {
  path?: readonly (string | number | symbol | PathSegment)[] | undefined;
  message: string;
}

function segmentToString(segment: string | number | symbol | PathSegment): string {
  return typeof segment === "object" && segment !== null ? String(segment.key) : String(segment);
}

export function mapValidationIssues(issues: readonly ValidationIssue[]): FieldError[] {
  return issues.map((issue) => ({
    field: issue.path ? issue.path.map(segmentToString).join(".") : "",
    message: issue.message,
  }));
}
