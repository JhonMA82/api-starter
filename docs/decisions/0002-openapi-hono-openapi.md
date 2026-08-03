# ADR-0002: OpenAPI integration - hono-openapi over @hono/zod-openapi

- Status: Accepted
- Date: 2026-08-02
- Scope: Fase 1 (foundation), OpenAPI contract

## Context

The spec mandates a **single source of truth** for contracts: zod schemas
co-located with the HTTP layer are reused for request validation, OpenAPI
document generation, TypeScript types, and tests (spec §8.1). The generated
document must be **OpenAPI 3.1.0** (spec §3.3), and validation must accept
Standard-Schema-compatible schemas (spec §3.1). The framework is plain Hono
with modules composed as sub-apps (`modules/*` mounted under `/api/v1`).

Two OpenAPI integrations satisfy these requirements:

1. `hono-openapi@1.3.1` (rhinobase, community-maintained) - works with plain
   `Hono` instances via `describeRoute()`, `validator()`, `resolver()`, and
   `openAPIRouteHandler()`.
2. `@hono/zod-openapi@1.5.1` (official honojs/middleware monorepo) - requires
   the `OpenAPIHono` subclass, declarative `createRoute()` definitions, and
   OpenAPI 3.1 only through a secondary API (`doc31()`); the default `doc()`
   still emits 3.0.0.

## Options

1. **hono-openapi@1.3.1**: native OpenAPI 3.1.0 generation; Standard Schema
   source (zod, valibot, arktype, etc.); plain-Hono routes stay untouched so
   module composition and future Hono RPC client inference (`$()`) remain
   idiomatic; `@hono/standard-validator@0.2.3` bridges zod validation. Risk:
   community-maintained (777 stars, single-org).
2. **@hono/zod-openapi@1.5.1**: official org maintenance; but replaces the app
   class (composition friction with plain-Hono sub-apps, `:param` vs `{param}`
   mount mismatch), zod-only schema source, and 3.1 requires the secondary
   `doc31()` API.

## Decision

Adopt **hono-openapi@1.3.1** for OpenAPI document generation. Schemas remain
**plain zod** (never bound to the library), giving the triple feed: types via
`z.infer`, OpenAPI via `resolver(ProblemDetailsSchema)` inside
`describeRoute()`, and test parsing via `Schema.parse`. Every documented
route's error responses reference the shared ProblemDetails schema so every
error appears in the spec. `@hono/standard-validator` must stay pinned at
exactly **0.2.3**: hono-openapi declares the peer range `^0.2.0` and the 0.3.x
line violates it (R4 peer trap).

## Consequences

- OpenAPI 3.1.0 is emitted natively (`openapi: "3.1.0"` in `/openapi.json`);
  no 3.0 compatibility shims.
- Module composition is preserved: each `modules/*` exports a plain Hono
  sub-app with `describeRoute` docs; the root app composes them and generates
  the final document via `openAPIRouteHandler` with `exclude`.
- Because schemas stay plain zod and routes stay plain Hono, migration to
  `@hono/zod-openapi@1.5.1` (if this project stalls) is cheap and bounded.
- Community-maintenance risk is accepted and monitored; peer-dependency traps
  (standard-validator 0.2.x) are documented in the catalog.

## Revisit conditions

Revisit if hono-openapi development stalls or produces OpenAPI 3.1 gaps that
block contract tests, or at **Fase 2** when the contract test surface grows;
fallback is `@hono/zod-openapi@1.5.1` with plain-zod schemas preserved.
