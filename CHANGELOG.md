# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.9.0] - 2026-08-03

### Added

- Frontend integration kits (Fase 9): framework-agnostic TypeScript SDK
  `@consulting/sdk` with an injectable standard `fetch`, cookie/bearer auth,
  the `x-organization-id` tenant header (per-request override), bounded RFC
  9457 problem errors (`ApiClientError`) and typed resources for auth,
  organizations, apiKeys, files and webhooks; no runtime dependencies.
- TanStack Query v5 structural kit (`src/tanstack.ts`): dependency-free stable
  query keys/options for session, organizations, organizationContext, files,
  webhooks and apiKeys, plus mutation invalidation descriptions.
- Next.js App Router kit (`src/next.ts`): server client with explicit cookie
  forwarding (no `next/headers` import) and a `cache: no-store` default for
  sensitive data, browser client with `credentials: "include"`, stable query
  tags, no duplicate API routes and no localStorage secrets.
- Mobile kit (`src/mobile.ts`): secure injected token store
  (Keychain/Keystore/SecureStore), single-flight refresh, bearer client with
  `credentials: "omit"`, idempotency keys and an upload form helper.
- Offline kit (`src/offline.ts`): durable mutation queue (in-memory store for
  tests), bounded exponential retry with jitter, idempotency headers, no
  payload logging and no background timers.
- Tauri kit (`src/tauri.ts`): credential bridge over injected `invoke`,
  system-browser auth callback with scheme validation, and no plaintext
  secrets or localStorage.
- Integration examples under `integrations/` (tanstack-query,
  next-app-router, ignite-react-native, tauri) and ADR-0011 (frontend
  integration kits).

## [0.8.0] - 2026-08-03

### Added

- Fase 8 generator catalog with 12 declarative features, five profiles,
  committed JSON manifests and validation for unknown ids, duplicates, missing
  requirements and excluded-feature conflicts.
- `create:project` with physical feature pruning, migration snapshot and
  journal surgery, template selection, dependency/configuration rewrites and
  safe destination idempotency with explicit `--force`.
- `create:module` with global, user and tenant scopes plus optional CRUD,
  domain events and best-effort audit scaffolding.
- `add:feature` with transitive requirement closure, the `multitenancy` alias,
  marker-aware safe overwrites, generated feature plans and a non-executed
  tenancy migration warning plan that never mutates data.
- ADR-0010 (generator profiles, physical feature pruning and safe evolution).

## [0.7.0] - 2026-08-03

### Added

- Files & notifications (Fase 7): `@consulting/module-files` with the
  `FileStorage` interface (in-memory + local-filesystem adapters; S3/R2/
  MinIO drop-in later) and the `files` metadata table (migration 0010)
  as REFERENCES only — no blobs in PostgreSQL — with server-generated
  storage keys (`<orgId>/<uuid>/<name>`), sha256 content hash, MIME
  allowlist (png/jpeg/webp/pdf/txt/json) and a 10 MiB size cap;
  upload/download/soft-delete/list use cases with an injected
  membership guard.
- HMAC-signed download URLs: expiring tokens
  (`base64url(payload).hex(HMAC-SHA256)`) with timing-safe verification
  that never throws, a public token-authorized download route (401
  expired/malformed, 404 deleted/missing), one-time `downloadUrl` on
  upload (201) and fresh signed-URL issuance
  (`POST /api/v1/files/:id/url`, default 3600s, cap 86400s).
- `@consulting/module-notifications` with `Mailer`/`NotificationChannel`/
  `TemplateRenderer` interfaces (no provider coupling — fail-fast SMTP
  stub, log-mailer for dev, noop for tests), versioned code-first
  templates with es-default fallback (exact locale → es → first
  available), the `sent_mails` dedupe ledger (migration 0011, unique
  `dedupe_key`, `onConflictDoNothing`), async send via the JobQueue
  (worker re-checks dedupe, rethrows `MailerUnavailableError` for the
  retry policy), and logs that never include bodies.
- ADR-0009 (files and notifications: storage abstraction, signed URLs,
  mailer interfaces).

## [0.6.0] - 2026-08-03

### Added

- Integrations (Fase 6): transactional outbox (`outbox_events`, migration
  0005) with same-transaction domain event emission (dedupe by `event_id`,
  statuses pending/processing/succeeded/failed/dead_letter, max 5 attempts,
  exponential backoff, controlled reprocessing).
- `modules/jobs` JobQueue (`jobs` table, migration 0006) with PostgreSQL and
  in-memory (tests-only) adapters, plus the outbox worker (polling,
  per-event handlers, `1s · 2^attempts` backoff capped at 1h, dead-lettering
  after max attempts).
- Organization API keys (migration 0007): hash-only storage (sha256 +
  8-char prefix), one-time secret at creation, expiry/revocation/last-used
  tracking, tenant-scoped with cascade on organization delete, bearer
  middleware (session cookie takes precedence), `api_key.created`/
  `api_key.revoked` domain events and audit entries.
- Outgoing webhooks (`webhook_endpoints`/`webhook_deliveries`, migration
  0008): HMAC-signed deliveries (`x-webhook-signature`,
  `x-webhook-timestamp`, `x-webhook-event-id`, `x-webhook-event-type`,
  `idempotency-key`), payload redaction, exponential retry backoff,
  delivery history, and outbox fan-out to subscribed endpoints.
- Incoming webhooks (`incoming_webhooks`, migration 0009): verify-before-
  parse HMAC signature (timing-safe, 5-minute window), DB-level
  `(provider, event_id)` idempotency, redacted stored payloads, async
  processing via the JobQueue, `webhook.received` audit, and public route
  `POST /api/v1/webhooks/incoming/:provider` (202 accepted/duplicate, 401
  bad signature, 404 unknown provider).
- ADR-0008 (integrations: transactional outbox, job queue, API keys,
  webhooks).

## [0.5.0] - 2026-08-03

### Added

- Multi-tenancy (Fase 5): `modules/organizations` (organizations/memberships/
  invitations cluster, migration 0004) with a shared-schema model —
  tenant rows carry `organization_id`, repositories scope every query to the
  tenant, and `x-organization-id` drives the mandatory resolution flow
  (`TenantContext` + tenancy service; unknown organizations 404 vs suspended/
  inactive memberships 403).
- Predefined organization roles (`owner`/`admin`/`auditor`/`member`) as a
  membership column, single-owner invariant with a last-owner guard, and
  deferred dynamic role tables (ADR-0007).
- Tenant-scoped repositories with IDOR protection (`{ organizationId, id }`
  filters; invitations resolved by global token hash) and IDOR tests.
- Lifecycle use cases and HTTP routes (create, tenant context, invite,
  accept-invitation, transfer ownership, suspend, remove member, delete with
  strong confirmation) and lifecycle invariants (last-owner guard,
  invitation expiry/single-use, cascade deletion).
- Per-tenant audit via `@consulting/audit`: every lifecycle success records
  `resourceType: "organization"` + `resourceId` + actor + outcome through
  `createOrganizationAudit`, best-effort so audit never breaks the business
  operation; real-DB assertions in the tenancy integration test.
- ADR-0007 (multi-tenancy, shared schema); CP-B coverage extension for
  organizations infrastructure (no-DB coverage ignores infra + test fakes).

## [0.4.0] - 2026-08-03

### Added

- Authorization (Fase 4): `@consulting/authorization` pure core with an explicit
  `request.*` permission catalog (create/read/update/assign/review/approve/
  reject/export/delete, no wildcards), admin/reviewer/member roles, deny-by-default
  `authorize()`, ABAC policy functions (`canUpdateRequest`, `canApproveRequest`
  with separation of duties, `canDeleteRequest`), and a declarative
  `PERMISSION_MATRIX` computed from role grants.
- Problem codes `UNAUTHORIZED` (401) and `FORBIDDEN` (403) in `packages/core`.
- `requirePermission` middleware with the injectable `getRoles` seam in
  `createApp(config, { auth, getRoles })` (defaults to deny), plus demo routes
  `GET /api/v1/authorization/protected` and `GET /api/v1/authorization/admin`.
- Audit (Fase 4): `@consulting/audit` with the append-only `audit_log` table
  (migration 0003), a database-level append-only trigger
  (`audit_log_append_only` / `reject_audit_log_mutation()`), and a
  `record(input)` / `list({ limit? })` API with no update/delete surface.
- Real-DB tests for both packages (skip when `DATABASE_URL` is unset) and
  updated migration suites (4-migration journal); CP-B coverage extension to
  `packages/audit/src`.

## [0.3.0] - 2026-08-03

### Added

- Authentication (Fase 3): Better Auth 1.6.25 isolated in `packages/auth`
  (`@consulting/auth`) with the drizzle adapter (user/session/account/verification
  tables), email/password, and `bearer()` + openAPI plugins.
- Browser-safe client `packages/auth-client` (`@consulting/auth-client`) for
  web/browser code.
- Auth env vars: `BETTER_AUTH_SECRET` (required), `BETTER_AUTH_URL`,
  `TRUSTED_ORIGINS`.
- `/api/auth/*` handler and session middleware seam in `createApp(config, { auth })`
  (`c.get("user")` / `c.get("session")`); auth OpenAPI 3.1.1 schema exposed as an
  "Auth" source in Scalar `/docs`.
- Migration 0002 (user/session/account/verification) with indexes and cascade FKs.
- Real-DB auth tests (signup/signin/signout flows, cookie attributes, origin
  security matrix, migration upgrade, boundary scan) that skip when `DATABASE_URL`
  is unset; CI migration job extended to run the auth migration tests.

## [0.2.0] - 2026-08-02

### Added

- Persistence stack (Fase 2): PostgreSQL 17 + Drizzle ORM 0.45.2 + postgres.js
  3.4.9, `DATABASE_URL` fail-fast validation, and ADR-0005 (with ADR-0001
  toolchain revisit note).
- Committed SQL migrations under `migrations/` (v1 notes schema + v2 `pinned`
  column) generated by drizzle-kit 0.31.10.
- `modules/notes`: reference module proving the §6 layering
  (domain/application/infrastructure) and §9.5 UnitOfWork, with real-DB tests
  (skip when `DATABASE_URL` is unset).
- DB scripts `db:generate` / `db:migrate` / `db:seed` / `db:up` / `db:down`
  and the `postgres` service in docker-compose (profile `database`).
- CI jobs `migrations-check`, `integration-test`, and `migration-test`
  (postgres:17-alpine service containers).
- Spanish migration runbook (`docs/migrations-runbook.md`).

## [0.1.0] - 2026-08-02

### Added

- Independent git repository for the reusable Hono API starter.
- `.bun-version` pin (1.3.14) and MIT `LICENSE`.
- `catalog/dependencies.json`: Fase 0 pinned-version/license registry (toolchain,
  runtime, dev, docker, and GitHub Actions pins).
- ADRs 0001-0004: toolchain, OpenAPI integration, error model, version pinning.
