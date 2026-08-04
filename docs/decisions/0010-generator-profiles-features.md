# ADR-0010: Generator - declarative profiles, physical feature pruning, and safe evolution

- Status: Accepted
- Date: 2026-08-03
- Scope: Fase 8 (generator)

## Context

Fase 8 (spec §4, §18.1-18.5) adds tooling for producing a project with a
selected capability set and evolving that project later. The generator must
keep profiles as presets while allowing features to be configured
independently. A generated project must not merely hide unselected
capabilities: their modules, packages, migrations, snapshots, configuration
and feature-owned application tests must be physically excluded so that the
result has no dangling imports or unrelated runtime surface.

The generator also needs to be safe to use repeatedly. Existing destinations,
custom files and generated files require an explicit overwrite policy, and
incremental feature additions must not silently alter application data. Module
generation must preserve the scope semantics required by the spec, including
global, user-scoped and tenant-scoped scaffolds.

## Options

1. **Declarative TypeScript catalog + committed JSON manifests + template
   variants + physical pruning** [chosen]: keep the feature and profile source
   of truth in TypeScript, commit synchronized JSON manifests, select
   feature-aware app and route templates, and physically remove resources that
   are not in the resolved plan. This keeps planning, validation and generated
   output deterministic without adding runtime dependencies.
2. **Runtime feature flags while installing everything**: rejected — §4.7
   requires the starter's capability boundaries to remain meaningful; shipping
   every module and migration creates unused surface, dependency drift and
   misleading installations.
3. **Free-form copying or surgical string edits**: rejected — ad hoc edits can
   leave dangling imports, inconsistent configuration and template drift that
   is difficult to validate.
4. **Silently overwrite the destination or project files**: rejected — §18.3
   requires safe failure for existing content and protection for custom files;
   `--force` must be an explicit choice.
5. **Couple the generator to a CLI framework or runtime package manager**:
   rejected — the generator has no runtime dependencies and uses Bun/Node
   built-ins only, keeping the tooling small and portable within the chosen
   toolchain.

## Decision

Ship Fase 8 as a standalone `generator/` tooling package outside the root
workspaces. It provides a declarative catalog, validation, project generation,
module scaffolding and incremental feature addition.

- **Catalog and validation:** `generator/src/features.ts` and
  `generator/src/profiles.ts` are the TypeScript source of truth. The catalog
  contains 12 features and records requirements, exclusions, owned modules and
  packages, migrations and environment variables. `sync-manifests.ts` keeps
  the committed `generator/features.json` and `generator/profiles.json`
  manifests synchronized and formatted. Validation rejects unknown features or
  profiles, duplicate feature ids, missing requirements and `excludedBy`
  conflicts.
- **`create:project`:** resolve a profile, copy the source tree while
  excluding repository/tooling-only paths, then physically prune unselected
  modules, packages, migrations, migration snapshots and feature-owned app
  tests. Rewrite workspace dependencies, Drizzle configuration and generated
  environment files, choose the matching app/routes template variants, and
  write `GENERATED.md`. A non-empty destination is rejected unless `--force`
  is supplied.
- **Migration journal surgery:** the generated
  `migrations/meta/_journal.json` is filtered to retained migrations and its
  `idx` values are renumbered sequentially; snapshots for removed migrations
  are removed as well. This keeps the generated migration runner coherent
  after physical pruning.
- **Templates and tests:** app and route composition uses manually maintained
  variants instead of surgical source edits. Templates carry the generator
  marker, and application tests owned by excluded features are pruned with
  those features. The standalone templates are covered by import/e2e scans and
  are excluded from typechecking because workspace dependencies are not
  resolvable from the standalone generator package.
- **`create:module`:** generate a module from a kebab-case name with
  `global`, `user` or `tenant` scope. `--crud`, `--events` and `--audit`
  independently add CRUD infrastructure and HTTP routes, domain events and a
  best-effort audit seam. Scope-aware scaffolds carry `userId` or
  `organizationId` where applicable, and an existing module is protected
  unless `--force` is supplied.
- **`add:feature`:** read `GENERATED.md`, normalize the accepted
  `multitenancy` alias to `tenancy`, and optionally resolve the transitive
  requirement closure with `--with-requires`. Copy physical resources,
  migrations, tests and templates; rewrite dependencies, configuration,
  environment files and the migration journal; and write `FEATURE_PLAN.md`.
  An already-enabled feature is a no-op.
- **Marker and force policy:** generated artifacts are marked so the
  incremental command can distinguish them from custom content. Custom or
  unmarked project files are protected by default; `--force` is required to
  recreate or overwrite protected content. The generator prints `bun install`
  as the next step and never edits `bun.lock` itself.
- **Tenancy evolution:** adding `tenancy` emits a warning and a non-executed
  migration plan. The plan calls for reviewing tenant-scoped tables, adding
  `organization_id`, backfilling, adding indexes and constraints, and adding
  IDOR/isolation tests. No application data is changed automatically.

## Consequences

- The generator remains outside the root workspaces and introduces no runtime
  dependencies. Its TypeScript catalogs and JSON manifests are committed
  source-controlled artifacts.
- Physical pruning produces smaller, clearer projects with no unselected
  runtime surface, but generated projects must run `bun install` after
  creation or feature addition. Provider wiring remains an application task;
  S3/R2/MinIO and SMTP transports may need configuration or adapters.
- Template variants are manually maintained and must stay synchronized with
  the source composition. They are intentionally excluded from typechecking;
  import and end-to-end scans provide the relevant coverage.
- `add:feature` can rewrite project metadata and migration bookkeeping, but it
  does not edit `bun.lock` or execute data migrations. Tenancy data changes
  therefore require an explicit review and application-specific migration.

## Revisit conditions

Revisit when any of the following holds:

- More profiles or features require a different catalog or dependency-closure
  model.
- Generated Dockerfile or CI variants need profile-specific completeness.
- An integration profile becomes feasible and its provider contracts are
  stable.
- Template drift can be checked or generated automatically without obscuring
  the source composition.
- Package-manager portability becomes a requirement beyond the Bun/Node
  built-in implementation.
