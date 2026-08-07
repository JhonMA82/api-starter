# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **Documentation reorganization:** rewrote `README.md` as a landing page with two
  explicit paths (create a new API / maintain the starter) and a functional
  quickstart that generates a project; created `docs/README.md` as a
  task-oriented index; split `docs/architecture.md` into
  `docs/architecture/` (overview, layers-and-boundaries, capabilities,
  generator-and-managed-files); split `docs/updating-generated-projects.md`
  into `docs/guides/` (add-a-feature, update-a-generated-project,
  adopt-a-legacy-project); moved runbooks to `docs/operations/`
  (migrations, backup-and-restore, load-testing) with a standard header
  (audience, prerequisites, risk, verification, rollback); moved the threat
  model to `docs/security/threat-model.md`; added `docs/getting-started/`
  (choose-a-profile, create-a-project, first-module) and
  `docs/maintainers/` (development, testing-and-ci, releases-and-versioning,
  evolution-policy, feature-proposal-template); added `docs/reference/`
  (cli, environment, profiles-and-features, endpoints, repository-structure).
- **Archive:** moved the original specification and closed verification
  reports to `docs/archive/` (original-specification.md,
  verification-reports/final-validation-0.10.0.md,
  verification-reports/update-system-vnext-2026-08-06.md,
  verification-reports/load-test-results-2026-08-03.md) with explicit
  non-normative banners; `VALIDATION_REPORT.md` (root) removed in favor of
  the archived report. `docs/openspec/` and `docs/superpowers/` stay in
  place (tooling depends on exact paths) and are excluded from onboarding.
- **Docs checks:** new `scripts/check-docs.ts` and `bun run docs:check`
  (internal markdown links, renamed-path detection, `bun run` script
  references against `package.json`, stale version detection in active docs,
  catalog/reference sync); added the `docs` job to CI.
- **Link migration:** updated references in `AGENTS.md`, ADR-0012/0013,
  `Dockerfile`, `scripts/db/backup.ts`/`restore.ts` and the generator
  exclusion list (the archived original spec is still excluded from
  generated projects by basename).
- **Version alignment:** `APP_VERSION` default in `packages/config`,
  `.env.example`, `.env.test.example` and Docker `IMAGE_VERSION` aligned to
  `0.11.0`.

## [0.11.0] - 2026-08-06

### Added

- **Granular profiles (Parte A):** nuevos perfiles `multi-tenant-core` (persistence, auth, authorization, tenancy, audit) e `integration-platform` (core + apiKeys, jobs, webhooks); `platform` ahora es la unión completa salvo `dynamicRoles`; `multi-tenant` preservado como alias **deprecated** con `replacementProfiles: [multi-tenant-core, integration-platform, platform]` y advertencia a stderr. Soporte para composición exacta por features: `bun run create:project -- --features=persistence,auth,... --out=...` y `bun run create:project -- --profile=multi-tenant-core --with=files,notifications --out=...` con clausura transitiva, rechazo de `excludedBy`, orden determinista y `planFeatureSet`/`planFromSelection` como planner puro único. Flags `--list-profiles`/`--list-features` (con `--json`) en `create:project` y `generator:validate`.
- **Validación reforzada:** `generator:validate` verifica IDs únicos, features conocidas, deps transitivas, conflictos, ciclos, orden determinista, reemplazos deprecated válidos y que `platform` == unión completa salvo diferidas.
- **Manifiesto versionado (Parte B):** `.api-starter/manifest.json` (schema 1, `starter` + `generation` + `managedFiles` con `sha256:` + `appliedUpdates`), `generator/src/manifest.ts` (validación estricta, escritura atómica `tmp→rename`, orden estable), `generator/src/hashing.ts` (SHA-256), `generator/src/materialize.ts` (`materializeToTemp` compartido). `create:project` emite el manifiesto y mantiene `GENERATED.md` como vista humana; `add:feature` lo parchea atómicamente; `readManifestOrLegacy` mantiene compatibilidad con warning.
- **Adopción legacy:** `bun run generator:adopt -- --project=../legacy --baseline=0.10.1` lee `GENERATED.md` solo como entrada, valida contra el catálogo, compara contra baseline materializado, reporta `intact`/`customized`/`missing` y crea el manifiesto solo si es verificable.
- **Doctor / Diff / Update (Parte C):** `generator:doctor` (11 checks, `--json`, `git-dirty` como warning), `generator:diff` (read-only, materializa canónica con mismas features, clasifica `add`/`update-safe`/`remove-safe`/`unchanged`/`customized-no-upstream`/`conflict`/`manual-migration`, exit 1 si conflicto), `generator:update` (dry-run sin `--apply`, sin `--force` global, aborta con conflictos, backup en `.api-starter/backups/<ts>/`, determinista, post-validación `typecheck`/`test`, rollback automático y bump de manifiesto solo al final, idempotente). `file-strategies.ts` (`managed`/`structured`/`scaffold`/`ignored`) con merge conservador para `package.json` y `.env.example`; nunca toca `.env`.
- **Migraciones versionadas (Parte D):** `generator/updates/registry.ts` (`STARTER_VERSION`, `Update` con `plan` puro, `resolveUpdatePath` SemVer secuencial sin saltos, idempotente), `generator/updates/0.10.1-to-0.11.0.ts` ejemplo, manejo de `migrations/meta/_journal.json` con detección de colisiones, `manual-migration` para tenancy, sin `db:migrate` automático.
- **Gobernanza (Parte E):** `docs/decisions/0013-starter-evolution-and-update-policy.md` (qué es/no es el starter, políticas Core/Feature/Recipe/Dominio, compatibilidad, propiedad del código, estrategia de actualización, prohibición de framework privado, admisión y presupuesto de complejidad), `docs/feature-proposal-template.md` (10 puertas), `docs/updating-generated-projects.md` (flujo `doctor`→`diff`→`update`→`adopt` y resolución de conflictos), `generator/updates/registry.ts` como fuente de verdad.
- **Docs y scripts:** `docs/architecture.md` (sección Generador con perfiles granulares y flags), `README.md` (comandos con nuevos perfiles y `--features`/`--with`), `package.json` scripts `generator:doctor`/`generator:diff`/`generator:update`/`generator:adopt`, `biome.json` ignora `docs/openspec`/`docs/superpowers`/`.superpowers`/`.comet` para `lint`.

### Changed

- `generator/profiles.json` y `generator/src/profiles.ts` ahora con 7 entradas ordenadas alfabéticamente y `features` sorted; `PROFILES` espejo via `sync-manifests.ts`.
- `generator/src/plan.ts` con `parseCsv`/`closeTransitive`/`planFromSelection` y `planFeatureSet` con cierre transitivo automático.
- `generator/src/create-project.ts` con `generateProjectFromPlan`, `excludePath` ampliado a `.agents/.opencode/.comet/.superpowers` y `collectManagedFiles` para el manifiesto.

### Deprecated

- Perfil `multi-tenant` marcado `deprecated: true` con `deprecatedReason` y `replacementProfiles`; su eliminación se reconsiderará en `0.12.0`.

## [0.10.1] - 2026-08-05

### Changed

- Documentation: rewrote `README.md` as a concise user guide (quickstart,
  commands, endpoints, repo structure) and `docs/architecture.md` as an
  architecture + capability catalog; removed phase jargon ("Fase X", "spec §"
  references to the untracked spec) and corrected the `DATABASE_URL` note
  (the server starts without a database; auth routes and persistence modules
  need it). Cleaned up `docs/threat-model.md`, `docs/backup-restore.md`,
  `docs/load-test-results.md` and `docs/migrations-runbook.md`.
- Moved the original spec `OPENCODE_HONO_BACKEND_REUTILIZABLE.md` under
  `docs/` and linked it from the README documentation index.
- `.gitignore`: ignore local tooling directories (`.codegraph/`, `.atl/`).
- Version bump: aligned all workspace manifests (17 `package.json` files),
  `.env.example`, `.env.test.example`, the `APP_VERSION` default in
  `packages/config` and the Docker `IMAGE_VERSION` default to `0.10.1`.

## [0.10.0] - 2026-08-03

### Added

- Hardening (Fase 10): threat model in `docs/threat-model.md` (spec §20) —
  one row per §20.1 threat with `file:line` mitigations, the §20.2 mandatory
  controls table, the §20.3 admin-support policy (no support surface, disabled
  by default as a future requirement) and §20.4 personal data treatment; the
  documented 10 MiB file-upload cap was unreachable behind the 1 MiB global
  `bodyLimit` and was aligned in `apps/api/src/app.ts` and
  `modules/files/src/http/file.routes.ts` with tests.
- Hardening (Fase 10, WU2): dependency-free Prometheus-compatible metrics
  registry in `packages/core` (counters/gauges/histograms, text exposition
  `text/plain; version=0.0.4`), request metrics middleware
  (`http_requests_total`, `http_request_duration_seconds`, `http_errors_total`)
  and `GET /metrics`; pseudonymized `userId`/`tenantId` in request logs
  (`LogEntry` contract, never bodies/emails/headers); decoupled
  `Tracer`/`Span` contract with `createNoopTracer()` (no OpenTelemetry
  dependency, provider adapter is a future drop-in); outbox and webhook
  delivery counters with no ids in labels; generator manifest entry for the
  metrics tests.
- Hardening (Fase 10, WU3): reproducible Bun-only load generator
  `scripts/load-test.ts` (duration/concurrency/rate/path options, JSON
  summary, conservative rate gate) with `docs/load-test.md` and results in
  `docs/load-test-results.md` (0 errors; ~190-250 req/s at 20 workers on
  localhost).
- Hardening (Fase 10, WU4): Dockerfile multi-stage que instala el workspace
  completo con `--frozen-lockfile` (todos los manifests de apps/packages/
  modules), labels OCI versionables por build (`IMAGE_VERSION`, default
  0.10.0, y `IMAGE_SOURCE`), `STOPSIGNAL SIGTERM` y `APP_VERSION` desde el
  build; `.dockerignore` endurecido (dumps, tooling local y coverage fuera
  del contexto).
- docker-compose: perfil `worker` con el nuevo `scripts/worker.ts` (poll del
  outbox con fan-out de webhooks y shutdown graceful sobre SIGTERM/SIGINT);
  documentado por qué los perfiles redis/storage/observability se omiten a
  propósito (spec §23.2, sin servicios inexistentes) y sus puntos de
  extensión (ADR-0008/ADR-0009).
- Backup/restore probados (control §20.2): `scripts/db/backup.ts` (pg_dump
  custom, contraseña solo por `PGPASSWORD`, logs enmascarados),
  `scripts/db/restore.ts` (`--file` + `--force` destructivo, `pg_restore
  --clean --if-exists` para custom y `psql` para plain), tests reales
  backup→validate→restore en DB scratch cuando las herramientas existen, y
  runbook `docs/backup-restore.md` (rotación, drill de verificación, RPO/RTO).

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
