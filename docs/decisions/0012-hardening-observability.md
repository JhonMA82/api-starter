# ADR-0012: Hardening - threat model, observability, load testing, and operational readiness

- Status: Accepted
- Date: 2026-08-03
- Scope: Fase 10 (hardening)

## Context

Fase 10 closes the starter's hardening gap (spec §20, §22, §23, §31) before
the final validation report:

- **Threat model (§20):** the spec requires a documented threat model covering
  the threats of §20.1, the mandatory controls of §20.2, the admin support
  policy of §20.3 and the treatment of personal data of §20.4, with evidence
  (`file:line`) and residual risk per threat.
- **Observability (§22):** metrics and tracing must exist without coupling
  the starter to a provider (§22.3), and request logs must not leak user ids,
  tenant ids or payloads.
- **Load testing (§23):** reproducible load tests are required for the final
  validation without adding dependencies the starter would carry.
- **Operational readiness (§23, §20.2):** the Docker image must build with
  the full workspace, the outbox worker must run as a separate process, and
  backups must be **tested** (§20.2 "tested backups"), not just documented.

## Options

1. **Dependency-free metrics registry + Prometheus text endpoint +
   pseudonymized logging + decoupled tracer + Bun-only load script + hardened
   Docker + tested pg_dump/pg_restore scripts** [chosen]: keep the starter
   dependency-free; every piece is verified by the WU1-WU4 commits.
2. **Vendor metrics/OTel SDK/tracing libraries now**: rejected — provider
   coupling the spec explicitly avoids (§22.3); the starter has no vendor
   today, and a `Tracer`/`Span` contract with a noop default keeps the door
   open without a dependency.
3. **autocannon/k6 dependency for load tests**: rejected — no new deps are
   needed to validate the starter; a Bun-only script covers the reproducible
   scenario and documents dedicated tooling (k6/autocannon/wrk) as the path
   for production capacity planning.
4. **Redis/BullMQ or S3/MinIO compose stubs**: rejected — §23.2 forbids
   compose services without implementations; the queue and storage adapters
   remain documented extension points (ADR-0008/ADR-0009), not stubbed
   services.
5. **Untested backup documentation only**: rejected — §20.2 requires tested
   backups; the runbook ships with real backup→validate→restore scripts and a
   drill against a scratch database.

## Decision

Ship Fase 10 as the four work units already committed (998bb9d, 5255557,
a073d7a, 036ddcd), each with its verification:

- **Threat model (WU1, spec §20):** `docs/threat-model.md` — one row per §20.1
  threat (surface, probability, impact, current mitigations with
  `file:line` evidence, residual risk, status), the §20.2 mandatory controls
  table, the §20.3 admin-support policy (no support surface today, disabled by
  default as a future requirement), §20.4 personal data treatment and a
  prioritized remediation order. The only code change: aligning the documented
  10 MiB file-upload cap with the 1 MiB global `bodyLimit`
  (`apps/api/src/app.ts`, `modules/files/src/http/file.routes.ts`) so the cap
  was actually reachable, with tests.
- **Metrics (WU2, spec §22.1/§22.2):** dependency-free registry in
  `packages/core/src/metrics.ts` (counters, gauges, histograms, Prometheus
  text exposition `text/plain; version=0.0.4`); request middleware
  `apps/api/src/http/metrics.ts` emitting `http_requests_total`,
  `http_request_duration_seconds` and `http_errors_total`; `GET /metrics`
  endpoint in `apps/api/src/routes.ts`; outbox and webhook delivery counters
  with no ids in labels (`outbox_processed_total`, `outbox_succeeded_total`,
  `outbox_failed_total`, webhook delivery counters) in
  `modules/organizations/src/application/outbox-worker.ts` and
  `deliver-webhook.ts`.
- **Logging (WU2):** `LogEntry` contract in `packages/core/src/logger.ts`
  (timestamp/level/service/environment/version/requestId/route/status/
  duration plus optional pseudonymized `userId`/`tenantId` and `traceId`);
  `apps/api/src/http/logger.ts` pseudonymizes raw ids (`pseudonymizeId`) and
  never logs bodies, emails or headers. No dead-letter counter is emitted on
  purpose (it would leak failure volume of the queue).
- **Tracer (WU2, spec §22.3):** decoupled `Tracer`/`Span` contract and
  `createNoopTracer()` in `packages/core/src/tracer.ts`; the logger starts a
  span per request when a tracer is injected. No OpenTelemetry dependency; an
  OTel adapter is a future drop-in.
- **Load test (WU3, spec §23):** `scripts/load-test.ts` (Bun only, no new
  deps) with duration/concurrency/rate/path options, JSON summary and a
  conservative rate gate; `docs/operations/load-testing.md` (how to run,
  scenarios, thresholds, CI integration) and the measured results in
  `docs/archive/verification-reports/load-test-results-2026-08-03.md` (runs
  against `/health`, `/api/v1/example/hello`, `/metrics`; 0 errors, ~190-250
  req/s at 20 workers on localhost).
- **Docker (WU4, spec §23.1/§23.4):** multi-stage `oven/bun:1.3.14-slim`
  build installing the **full workspace** with `--frozen-lockfile` (all
  apps/packages/modules manifests), OCI labels driven by build args
  (`IMAGE_VERSION` default 0.10.0, `IMAGE_SOURCE`), `STOPSIGNAL SIGTERM`,
  `APP_VERSION` from the build, hardened `.dockerignore` (dumps, local
  tooling, coverage outside the context) and non-root user.
- **Worker (WU4):** `scripts/worker.ts` + compose profile `worker` (outbox
  poll, webhook fan-out, graceful shutdown on SIGTERM/SIGINT). Compose
  profiles redis/storage/observability are documented as deliberately absent
  (spec §23.2) with their extension points in ADR-0008/ADR-0009.
- **Backup/restore (WU4, spec §20.2):** `scripts/db/backup.ts` (pg_dump
  custom, timestamped dumps under `backups/`, password only via `PGPASSWORD`,
  masked logs) and `scripts/db/restore.ts` (`--file` + mandatory `--force`,
  `pg_restore --clean --if-exists` for custom dumps, `psql` for plain), real
  backup→validate→restore tests against a scratch DB when the tools exist,
  and the runbook `docs/operations/backup-and-restore.md` (rotation,
  verification drill,
  RPO/RTO).
- **Generator sync (WU4):** the generator manifest/plan entries updated so
  generated projects keep the worker/compose/metrics surface coherent with
  their selected features (`generator/src/plan.ts`).
- **Final documentation (WU5):** the final validation report (archived at
  `docs/archive/verification-reports/final-validation-0.10.0.md`, spec §31),
  the CHANGELOG `0.10.0` consolidation, README and architecture updates.

## Consequences

- New `GET /metrics` endpoint: Prometheus-compatible text exposition of
  runtime metrics, safe to scrape; still subject to the no-auth public-route
  caveats listed in the threat model (rate limiting deferred).
- `LogEntry` fields: logs remain body-free and header-free; raw user/tenant
  ids never reach logs (pseudonymized), `traceId` only when a tracer injects
  it.
- Worker script + compose profile: the outbox worker runs standalone
  (`bun run worker` / `docker compose --profile worker`), drains on SIGTERM,
  and requires the same `DATABASE_URL` as the API.
- Dockerfile full-workspace fix: the image resolves every `workspace:*`
  dependency under `--frozen-lockfile`; the `IMAGE_VERSION` build arg keeps
  releases traceable via OCI labels.
- Backup/restore scripts + runbook: operators get a tested drill path
  (rotation, verification, RPO/RTO targets) instead of untested docs.
- Generator sync: generated projects stay consistent with the worker/compose
  and metrics surfaces of their features.
- Lint, typecheck, coverage gate and the full test suites (no-DB 856/0,
  real-DB ~742-746/0) remain green; the Docker image builds and passes smoke
  tests (health 200, non-root, graceful worker shutdown).

## Revisit conditions

Revisit when any of the following holds:

- Rate limiting middleware is added (threat-model priority 1).
- A CSRF double-submit token is implemented (same-site frontends no longer
  guaranteed).
- A vulnerability scan job (CI) and SBOM generation are scoped.
- An OpenTelemetry adapter is wired behind the `Tracer`/`Span` contract.
- A delivery retry sweeper is added on top of the JobQueue.
- File content validation (magic bytes) is implemented.
- Backup automation (cron) and restore drills move from runbook to code.
- Dynamic organization roles are un-deferred (ADR-0007/ADR-0010).
- Row-Level Security is adopted as a tenancy reinforcement.
