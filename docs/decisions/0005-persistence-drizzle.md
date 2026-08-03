# ADR-0005: Persistence - Drizzle ORM + postgres.js + committed SQL migrations

- Status: Accepted
- Date: 2026-08-02
- Scope: Fase 2 (persistence, notes reference module)

## Context

Fase 2 (spec §28) requires a PostgreSQL data layer for the starter: schema,
committed SQL migrations, an example repository module with real-DB tests,
transactions, and seeds. Three spec mandates constrain the choice:

- §9.2: postgres.js is the single database driver.
- §9.3: migrations are committed SQL files (generated, append-only); `push` is
  prohibited in production; the migration pipeline is proven from an empty
  database and from the previous version.
- §9.5: multi-entity mutations go through a UnitOfWork abstraction.

This is also the toolchain revisit that ADR-0001 scheduled for Fase 2: Drizzle
Kit (a native/Node-FFI toolchain entry) must be evaluated against the
TypeScript 7.0.2 + `skipLibCheck: true` setup.

## Options

1. **Drizzle ORM + postgres.js + committed SQL migrations applied in-process**
   [chosen]: schema-first `drizzle-kit generate` produces SQL + snapshots that
   are committed; `drizzle-orm/postgres-js/migrator` applies them in-process
   inside one transaction per pending batch; bookkeeping in
   `drizzle.__drizzle_migrations`; re-runs are no-ops.
2. **Raw SQL + hand-rolled migration runner**: full control, but reinvents
   bookkeeping, transactional apply, and type safety for no spec benefit.
3. **Prisma**: heavier, codegen-based, not spec-mandated; unnecessary surface
   for a starter.
4. **Kysely + postgres.js**: viable typed query builder, but no schema-first
   migration diffing; migrations must be authored by hand.
5. **Push-driven schema** (drizzle-kit push): rejected — explicitly prohibited
   by §9.3 for production; no committed migration history.

## Decision

Use **Drizzle ORM over postgres.js** with committed SQL migrations, pinned
exactly: `drizzle-orm@0.45.2`, `postgres@3.4.9`, `drizzle-kit@0.31.10`
(registered in `catalog/dependencies.json`).

- `drizzle.config.ts`: dialect `postgresql`, schema `modules/notes/src/
  infrastructure/note.schema.ts`, output `./migrations`, `strict: true`,
  dev-only URL fallback.
- Migration workflow: edit schema → `bun run db:generate` (`< /dev/null` guard
  against interactive rename prompts) → commit the generated SQL + `meta/`
  snapshots under `migrations/` (append-only; never edit deployed migrations).
- Apply in-process via `drizzle-orm/postgres-js/migrator` as
  `bun run db:migrate`: the whole pending batch runs in ONE transaction;
  bookkeeping lives in `drizzle.__drizzle_migrations` (idempotent re-run
  verified).
- `push` is prohibited in production; it is dev-only and only documented in the
  runbook as a prohibition.
- Rollback = restore from backup (no built-in down migrations); forward-fix =
  a new migration.
- Driver types (postgres.js `Sql`, drizzle `PgDatabase`/`PgTransaction`) never
  leave `modules/*/src/infrastructure`; `DATABASE_URL` is required
  (fail-fast via `z.url()` in envSchema); every opened client must
  `await client.end()` (postgres.js keeps the event loop alive).

## Consequences

- Catalog gains 3 entries (drizzle-orm, postgres, drizzle-kit).
- CI gains 3 jobs: `migrations-check` (generate + `git diff --exit-code` —
  `drizzle-kit check` does not detect drift), `integration-test` and
  `migration-test` with `postgres:17-alpine` service containers and
  `pg_isready` health checks.
- `modules/notes` is the reference implementation of §6 layering and §9.5
  UnitOfWork, with real-DB tests (skip when `DATABASE_URL` is unset) and a
  migration suite proving from-zero, v1→v2 upgrade, and idempotent re-run.
- Coverage plan per Q2: `coveragePathIgnorePatterns` excludes infrastructure
  from the no-DB coverage run (the integration jobs verify it instead).
- DDL inside a single transaction holds locks for the batch duration — fine at
  starter scale, revisit under lock pressure.

## Revisit conditions

Revisit when: a multi-replica concurrent migration strategy is needed
(§23.4), a second dialect is introduced (e.g. SQLite starter), or single-batch
transaction lock pressure becomes measurable at scale.
