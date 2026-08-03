# ADR-0003: Error model - RFC 9457 Problem Details

- Status: Accepted
- Date: 2026-08-02
- Scope: Fase 1 (foundation), HTTP error normalization

## Context

Every HTTP error must be consistent, machine-readable, and safe: no stack
traces, table names, or internal details may leak (spec §7.3). Errors must
carry a stable, documented `code` that clients can switch on, a `requestId`
for correlation with structured logs (spec §22.1), and field-level detail for
validation failures so clients can render `errors[].field` directly. The API
must normalize all failure paths through one place: unknown routes, validation
failures, body-limit (413), timeout (408), and unexpected errors (500).

## Options

1. **RFC 9457 Problem Details** (`type`, `title`, `status`, `detail`,
   `instance`) extended with a stable `code`, `requestId`, and optional
   `errors[]` field array. Normalization lives in a single `onError` /
   `notFound` pair in the HTTP layer, with pure builders (`buildProblemDetails`,
   `mapValidationIssues`) in `packages/core` so they are Hono-free and
   unit-testable.
2. **Ad-hoc `{ error: string }`**: minimal payload, but no stable codes, no
   field-level errors, no standard content type; clients must string-match.
3. **Bare RFC 7807** (no `code`, no `requestId`, no `errors[]`): standard
   shape but loses the machine-readable code and correlation fields the spec
   requires.

## Decision

Adopt **RFC 9457 Problem Details** with the extended shape
`{ type, title, status, code, detail, instance, requestId, errors[] }` served
with `Content-Type: application/problem+json` (spec §7.3). A fixed
status-to-code map normalizes all middleware failures:
400 -> `VALIDATION_FAILED` (with `errors[]`), 404 -> `NOT_FOUND`,
408 -> `REQUEST_TIMEOUT`, 413 -> `BODY_TOO_LARGE`, anything else ->
`INTERNAL_ERROR` with a generic detail. `instance` is the request path,
`requestId` comes from the request-id middleware. The model lives in
`packages/core` (zero Hono/Bun imports); the Hono glue lives in
`apps/api/src/http/errors.ts`; field errors are produced from zod issues with
`field = issue.path.join(".")`.

## Consequences

- All failure paths (notFound, onError, validation hook) funnel through the
  same normalizer and the same schema, which is also referenced in the OpenAPI
  document (ADR-0002) so every error appears in the spec.
- Clients can switch on `code` and render `errors[].field` without parsing
  prose; logs correlate via `requestId`.
- No stack traces, table names, or internals can reach the response; 500
  responses carry a generic detail.
- A stable `code` is a contract: adding or renaming codes is a breaking API
  change.

## Revisit conditions

Revisit at **Fase 3** when authentication introduces 401/403 codes (and
`VALIDATION_FAILED` may gain auth-specific siblings), or if a third-party
error format must be bridged.
