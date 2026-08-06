## Purpose

Enables explicit, reproducible custom feature compositions without requiring a named profile, with shared pure planning logic for create, validate and future update flows.

## ADDED Requirements

### Requirement: Custom feature composition via CLI

The `create:project` command SHALL accept either `--features=<csv>` for a fully custom set or `--profile=<id> --with=<csv>` for a profile base plus additions, but SHALL reject ambiguous combinations (both `--features` and `--with` with different bases producing ambiguity). Both forms SHALL resolve transitive dependencies via the catalog, reject conflicts via `excludedBy`, display the final deterministic plan before materialization, and record both the base profile (when present) and the exact final feature list in the output manifest/summary.

#### Scenario: User creates project via --features

- **WHEN** user runs `bun run create:project -- --features=persistence,auth,authorization,tenancy,audit,files --out=/tmp/my-api`
- **THEN** the materialized project keeps exactly those features plus their transitive deps, prunes all other modules/packages/migrations, and reports the plan including the resolved feature order

#### Scenario: User extends profile via --with

- **WHEN** user runs `bun run create:project -- --profile=multi-tenant-core --with=files,notifications --out=/tmp/x`
- **THEN** the result equals `multi-tenant-core` features plus `files` and `notifications` (with their transitive requirements like tenancy/jobs) in deterministic order, or fails with a conflict message if the addition conflicts

#### Scenario: Conflict is rejected

- **WHEN** user requests `--features=authorization,dynamicRoles` (where dynamicRoles is excludedBy authorization)
- **THEN** the generator exits non-zero with a message mentioning the conflicting pair

### Requirement: Single pure planner for all entry points

A single pure planner function `planFeatureSet(features, profileId?)` SHALL be the sole resolver of feature sets to `ProjectPlan` (including keep/remove lists for modules, packages, migrations, env vars, tests and files). `create:project`, `add:feature`, and `generator:validate` SHALL delegate to this planner and SHALL NOT duplicate the resolution logic.

#### Scenario: All entry points produce identical plans for same feature set

- **WHEN** `planFeatureSet(["persistence","auth"])` is called vs. `planProject("authenticated")` (which internally resolves to same set)
- **THEN** their `features`, `keepModules`, `keepPackages`, `keepMigrations` etc. are identical modulo `profile` label, and the generated `ProjectPlan` comparison succeeds

### Requirement: Discoverability flags for catalogs

The generator SHALL expose `--list-profiles` and `--list-features` flags (or equivalent `generator:validate --list-*` commands) that print the catalog in a machine-readable and human-readable way without materializing a project, suitable for CI and agents.

#### Scenario: Agent lists available features

- **WHEN** `bun run create:project -- --list-features` or `bun run generator:validate -- --list-features` is run
- **THEN** the output contains every feature id from `features.json` with description, requires and excludedBy, and exits zero without needing --profile/--out

### Requirement: Custom compositions are updatable without named profile

A project materialized via `--features` SHALL be considered first-class for future `generator:diff`/`generator:update` operations: the updater SHALL use the project's stored exact feature set (manifest) rather than requiring that a named profile exist for that combination.

#### Scenario: Custom project participates in future update

- **WHEN** a project generated with `--features=persistence,auth,tenancy,audit` is later processed by `generator:diff -- --project=...`
- **THEN** diff materializes the canonical target using that exact feature set and does not require a profile named "custom-persistence-auth-..."
