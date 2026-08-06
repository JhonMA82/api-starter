# Comet Design Handoff

- Change: granular-profiles-composition
- Phase: design
- Mode: compact
- Context hash: fe2fc9fdaff79b481e904d353b17c17720fea9e1a5027320ccbff961aef7a4f8

Generated-by: comet-handoff.sh

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## docs/openspec/changes/granular-profiles-composition/proposal.md

- Source: docs/openspec/changes/granular-profiles-composition/proposal.md
- Lines: 1-36
- SHA256: 4bbabccc79dc534194309927e3644aca716d24a4813cdd3aba7669b5cdf0b1a6

```md
## Why

The current `multi-tenant` profile bundles 10 features (persistence + auth + tenancy + audit + apiKeys + jobs + webhooks + files + notifications) into a single preset, mixing core SaaS tenancy with optional integration/product capabilities. Teams needing only a database, or only core tenancy without integrations, must fork or manually prune. A finer-grained profile set and explicit custom-feature composition are required to keep `api-starter` a code factory without combinatorial profile explosion, while preserving backward compatibility with the existing `multi-tenant` identifier.

## What Changes

- Add three new first-class profiles:
  - `multi-tenant-core` = persistence, auth, authorization, tenancy, audit
  - `integration-platform` = multi-tenant-core + apiKeys, jobs, webhooks
  - `platform` already represents full capabilities (now verified to equal all non-deferred features)
- Keep `minimal`, `data-api`, `authenticated` unchanged.
- Keep `multi-tenant` temporarily with identical composition but marked `deprecated: true` and `replacementProfiles: ["multi-tenant-core", "integration-platform", "platform"]` with a clear CLI warning on use; document its future removal.
- Extend `generator/profiles.json` schema to support `deprecated`, `deprecatedReason`, `replacementProfiles` metadata.
- Add explicit custom composition interfaces:
  - `bun run create:project -- --features=persistence,auth,... --out=...`
  - `bun run create:project -- --profile=multi-tenant-core --with=files,notifications --out=...`
  - Mutual exclusion and conflict (`excludedBy`) checks, transitive dependency resolution, deterministic ordering.
- Add discovery flags `--list-profiles` and `--list-features` (and `generator:validate --list-profiles/--list-features` equivalents) for CI/agent discoverability.
- Extract single pure planner `planFeatureSet(features, profileId)` / `planFromSelection(...)` used by `create:project`, `add:feature`, and `generator:validate`; remove duplicated logic.
- Expand `generator:validate` to verify unique IDs, known features, transitive deps, conflicts, cycles, deterministic order, deprecated replacements validity, and that `platform == all features` excluding `dynamicRoles` (deferred/incompatible).

## Capabilities

### New Capabilities
- `generator-profiles`: granular profile definitions, deprecation metadata, and deterministic validation guarantees for the profile/feature catalog.
- `generator-composition`: custom feature-set materialization without requiring a named profile, with transitive closure and conflict rejection, used identically by create, validate, and future updater.

### Modified Capabilities
<!-- No existing spec-level capabilities are being modified; this change introduces new generator behavior. -->

## Impact

- Affects: `generator/profiles.json`, `generator/features.json`, `generator/src/plan.ts`, `generator/src/profiles.ts`, `generator/src/features.ts`, `generator/src/validate.ts`, `generator/src/create-project.ts`, `generator/src/add-feature.ts`, `generator/src/cli-validate.ts`, `generator/tests/*`, `package.json` scripts, `docs/architecture.md` and `README.md`.
- CLI contract: new flags `--features`, `--with`, `--list-profiles`, `--list-features` added; existing `--profile`/`--out`/`--force` behavior preserved.
- No runtime impact on `apps/api`, `packages/*`, `modules/*` beyond what the existing pruning already covers.
- Tests: profile matrix, deprecation warnings, custom composition, deterministic ordering, and catalog validation.

```

## docs/openspec/changes/granular-profiles-composition/design.md

- Source: docs/openspec/changes/granular-profiles-composition/design.md
- Lines: 1-99
- SHA256: c6338c2aa41b3eefbffaf0fd470b03862fa8cad7374a7d48ec085b187b18406e

[TRUNCATED]

```md
## Context

See proposal.md - Why. Current generator has 5 profiles (minimal, data-api, authenticated, multi-tenant, platform) and a pure `planProject(profileId)` that assumes a named profile. `generator:validate` only checks basic feature-set validity per profile. `create:project` copies the repo tree then prunes via `computeRemoveList`. No `--features`/`--with` path exists and no shared `planFeatureSet` deduplication.

Constraints:
- Keep physical pruning, no runtime feature flags.
- `domain ← application ← http` and packages/modules layering preserved; generator must not import Hono/Bun.
- `bun.lock` and pins must stay exact; `platform` must track full feature union.
- `multi-tenant` cannot change silently; backward compat with deprecation warning required.

## Goals / Non-Goals

**Goals:**
- Add curated profiles `multi-tenant-core` and `integration-platform` with correct feature unions.
- Add deprecation metadata and CLI warning for `multi-tenant`.
- Support `--features` and `--profile --with` custom compositions with transitive closure and conflict rejection.
- Provide `--list-profiles`/`--list-features` discoverability in a deterministic, CI-friendly way.
- Consolidate planning into one pure planner reused everywhere.
- Strengthen `generator:validate` to cover uniqueness, known features, transitive deps, conflicts, cycles, ordering, deprecated replacement validity, and platform completeness.

**Non-Goals:**
- Versioned manifest (next change).
- Update engine (doctor/diff/update) and migrations.
- File-strategy merging for structured files.
- Governance ADR/template (later change).
- Interactive CLI wizard.

## Decisions

### Decision 1: Extend profiles.json with optional deprecation fields
- **Choice:** Add to `ProfileDefinition` interface: `deprecated?: boolean`, `deprecatedReason?: string`, `replacementProfiles?: string[]`, keeping `id/description/features` required. Persist in `generator/profiles.json`.
- **Rationale:** Explicit metadata matches spec §4.1 example and allows validation to check replacement existence without hard-coding.
- **Alternative:** Use separate `deprecatedProfiles.json` - rejected (fragments catalog, complicates validate).
- **Warning policy:** In `create-project.ts` after `planProject`, if `profile.deprecated` log to `console.warn` with `⚠ Profile "multi-tenant" is deprecated... Use one of: multi-tenant-core, integration-platform, platform. Reason: ...` and continue. Test asserts stderr capture.

### Decision 2: Keep physical pruning model; reuse `computeRemoveList`
- **Choice:** Custom compositions still produce a `ProjectPlan` (same `keep*/remove*` lists) and flow through existing copy→prune→rewrite→template pipeline.
- **Rationale:** No runtime flags; updater later reuses same materialization for diff.
- **Alternative:** Feature flag at runtime - rejected (violates non-negotiable principle 2).

### Decision 3: Single pure planner `planFeatureSet` + `planFromSelection`
- **Choice:** Export `planFeatureSet(features, profileId="custom")` (pure, validates, sorts). Add `planFromSelection({ profile?, features?, with?: })` that:
  1. Mutually excludes `--features` and `--with` (error if both supplied with distinct bases).
  2. Starts from profile features or empty.
  3. Merges `--with`/`--features` CSV, splits, trims, dedups.
  4. Resolves transitive closure by iterating `getFeature(id).requires` until fixpoint (or BFS), detecting cycles.
  5. Sorts deterministically (alphabetical) and validates via `validateFeatureSet`.
  6. Returns `ProjectPlan`.
- **Rationale:** One logic path prevents drift between create, validate, add-feature, diff/update.
- **Alternative:** Separate resolvers per command - rejected (duplication already flagged in spec §6).

### Decision 4: CLI extensions for create:project
- **New flags:** `--features=<csv>`, `--with=<csv>`, `--list-profiles`, `--list-features`, `--help` detail.
- **Parsing:** Keep manual argv loop (no extra dependency); `--features` sets `customFeaturesCsv`, `--with` sets `withCsv`. If `--list-profiles`/`--list-features` present, short-circuit to print and exit 0 without requiring `--profile`/`--out`.
- **Ambiguity rule:** If `--features` is supplied, `--profile` is ignored unless `--with` semantics explicitly requested? Spec requires no ambiguity: implement as:
  - `--features` alone → custom profile id `"custom"`.
  - `--profile X --with Y` → base X plus Y.
  - `--features` + `--profile` without `--with` → error: "ambiguous: use either --profile or --features, not both".
  - `--features` + `--with` → error similarly.
- **Deterministic plan display:** Before copy, `printSummary(plan, outPath)` already shows features; ensure custom path prints same and logs resolved features in sorted order.

### Decision 5: Generator validate strengthening
- **Checks added to `generator/src/validate.ts` + `cli-validate.ts`:**
  1. Duplicate profile ids.
  2. Unknown feature ids per profile.
  3. Missing transitive requirements (via validateFeatureSet).
  4. Conflicts via excludedBy.
  5. Cycle detection in requires graph (DFS).
  6. Deterministic ordering: `features` array must be sorted alphabetically (or at least stable vs sorted copy; fail if not).
  7. Deprecated: if `deprecated` true then `replacementProfiles` must be non-empty and every id must exist as profile; if deprecated falsy then replacementProfiles must be absent/empty.
  8. Platform completeness: `platform.features` sorted must equal sorted union of all feature ids except `dynamicRoles` and any future `excludedBy`-deferred (currently only dynamicRoles). Validate that platform includes observability, persistence, etc.
  9. Profile order stable (file order must be sorted by id? or at least validate no duplicates - we check file is deterministic).
- **Implementation:** New `validateCatalog()` function that reads `PROFILES` and `FEATURES` constants (which are generated from JSON). Use in `cli-validate.ts` for `generator:validate` exit codes. Support `--list-profiles`/`--list-features` there as well for agent ergonomics, sharing formatting code with create-project.

### Decision 6: No new dependencies
- **Choice:** Use only `node:fs`, `node:path`, existing `zod` for env if needed (not for profiles).
- **Rationale:** Keep generator lightweight per AGENTS.md pins.

## Risks / Trade-offs


```

Full source: docs/openspec/changes/granular-profiles-composition/design.md

## docs/openspec/changes/granular-profiles-composition/tasks.md

- Source: docs/openspec/changes/granular-profiles-composition/tasks.md
- Lines: 1-34
- SHA256: 4eca508e5768763f4d5a588061ae3f99d7522225a05f19df04cbbf2d45c6fefd

```md
## 1. Catalog and type updates

- [ ] 1.1 Extend `ProfileDefinition` in `generator/src/profiles.ts` with `deprecated?: boolean`, `deprecatedReason?: string`, `replacementProfiles?: readonly string[]` and update `PROFILES` constant to include `multi-tenant-core` and `integration-platform` profiles plus deprecated metadata for `multi-tenant`
- [ ] 1.2 Update `generator/profiles.json` to match the TypeScript source (six plus one deprecated entry, features alphabetically sorted, replacement profiles valid) and ensure `generator/src/profiles.ts` export stays in sync
- [ ] 1.3 Update `ALL_MIGRATIONS`/`ALL_MODULES`/`ALL_PACKAGES` guards in `generator/src/plan.ts` if needed and ensure `planFeatureSet` sorts features deterministically

## 2. Pure planner consolidation

- [ ] 2.1 Implement/extend `planFeatureSet(features, profileId)` to validate, transitive-close, sort, and build `ProjectPlan` as the single source of truth; add `planFromSelection({ profile, features, with: withFeatures })` handling mutual exclusion and CSV parsing
- [ ] 2.2 Refactor `planProject(profileId)` to delegate to `planFeatureSet` after `validateProfile`, and ensure `add-feature.ts` also delegates (if touched) rather than re-implementing
- [ ] 2.3 Add cycle detection utility and deterministic ordering helpers used by the planner

## 3. CLI: custom composition and discoverability

- [ ] 3.1 Extend `generator/src/create-project.ts` argv parsing to support `--features=<csv>`, `--with=<csv>`, `--list-profiles`, `--list-features`, `--help`; implement ambiguity error ("use either --profile or --features") and deprecated-profile warning to stderr
- [ ] 3.2 Extract listing formatters (profile/feature catalog printers) shared with `cli-validate.ts` so both commands support `--list-profiles`/`--list-features` consistently
- [ ] 3.3 Ensure plan summary prints final resolved feature list before materialization and that custom `profile` id is "custom" when `--features` is used

## 4. Validation hardening

- [ ] 4.1 Extend `generator/src/validate.ts` with `validateCatalog()` covering: duplicate ids, unknown features, missing transitive requirements, conflicts, cycles, ordering, deprecated replacement validity, and `platform` == full feature union excluding `dynamicRoles`
- [ ] 4.2 Update `generator/src/cli-validate.ts` to use the new catalog validator, wire `--profile=<id>` filtering plus `--list-profiles`/`--list-features` flags, and produce non-zero exit with actionable messages
- [ ] 4.3 Add helper to detect deterministic ordering violations and test it against intentionally unsorted fixtures

## 5. Tests

- [ ] 5.1 Update `generator/tests/catalog.test.ts` to assert the seven profile ids (including deprecated multi-tenant), their exact feature sets, deprecation metadata, deterministic ordering, and platform completeness
- [ ] 5.2 Extend `generator/tests/create-project.test.ts` with cases for: deprecated warning capture, `--features` custom composition prunes correctly, `--profile --with` merges transitively, `--features` conflict rejected, `--list-*` flags output deterministically, and ambiguity errors
- [ ] 5.3 Add unit tests for `planFeatureSet`/`planFromSelection`: transitive closure (e.g., webhooks→tenancy+jobs), cycle rejection, conflict via `excludedBy`, and idempotent sorting

## 6. Docs and baseline verification

- [ ] 6.1 Update `docs/architecture.md` profiles table and `README.md` generation section to document the six curated profiles, deprecated `multi-tenant`, and custom `--features`/`--with` interfaces
- [ ] 6.2 Run baseline matrix: `bun run lint`, `bun run typecheck`, `bun test`, `bun run generator:validate`, and materialize each profile to `/tmp` (`minimal`, `data-api`, `authenticated`, `multi-tenant-core`, `integration-platform`, `platform`) and verify each installs/types/tests

```

## docs/openspec/changes/granular-profiles-composition/specs/generator-composition/spec.md

- Source: docs/openspec/changes/granular-profiles-composition/specs/generator-composition/spec.md
- Lines: 1-51
- SHA256: 995423401e3d46f0dde1a71b14393facec3c31310398e9bac791f76e58dea206

```md
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

```

## docs/openspec/changes/granular-profiles-composition/specs/generator-profiles/spec.md

- Source: docs/openspec/changes/granular-profiles-composition/specs/generator-profiles/spec.md
- Lines: 1-66
- SHA256: 6f456caedc9cd00fe40122e5166734988ad1599b5e412175496c6b977743a94e

```md
## Purpose

Defines granular, curated API-starter profiles and their deprecation/validation contract so generators can materialize only the needed capabilities without combinatorial explosion.

## ADDED Requirements

### Requirement: Granular profile set exists

The generator SHALL expose exactly these six curated profiles with the listed feature sets:
- `minimal`: []
- `data-api`: [persistence]
- `authenticated`: [persistence, auth, authorization]
- `multi-tenant-core`: [persistence, auth, authorization, tenancy, audit]
- `integration-platform`: [persistence, auth, authorization, tenancy, audit, apiKeys, jobs, webhooks]
- `platform`: [persistence, auth, authorization, tenancy, audit, apiKeys, jobs, webhooks, files, notifications, observability]

#### Scenario: User lists profiles

- **WHEN** user runs `bun run generator:validate -- --list-profiles` or `bun run create:project -- --list-profiles`
- **THEN** the output lists the six profiles above with their description and feature list in deterministic alphabetical order

#### Scenario: Each granular profile materializes correctly

- **WHEN** `bun run create:project -- --profile=<each of the six>` is executed to a fresh directory
- **THEN** `bun install && bun run typecheck && bun test` succeed, and pruned modules/packages/migrations match the feature set exactly (no residual files from excluded features)

### Requirement: Legacy multi-tenant alias is deprecated but preserved

The profile identifier `multi-tenant` SHALL remain resolvable to its current full feature set [persistence, auth, authorization, tenancy, audit, apiKeys, jobs, webhooks, files, notifications] but SHALL be marked `deprecated: true` with `replacementProfiles: ["multi-tenant-core", "integration-platform", "platform"]` and a deprecation reason mentioning its planned reconsideration for removal. Selecting it SHALL emit a conspicuous warning to stderr recommending the three replacements but MUST still generate a valid project.

#### Scenario: User selects deprecated multi-tenant

- **WHEN** user runs `bun run create:project -- --profile=multi-tenant --out=/tmp/x`
- **THEN** the generator prints a warning containing the words "deprecated" and each of "multi-tenant-core", "integration-platform", "platform" and still completes materialization with the full feature set

#### Scenario: Validation accepts deprecated profile with valid replacements

- **WHEN** `bun run generator:validate` is executed
- **THEN** it passes when `multi-tenant` has deprecated=true and every replacement profile id exists; it fails if a replacement id is unknown or if a non-deprecated profile lists replacements

### Requirement: Profile metadata supports explicit deprecation

The profile definition schema SHALL support optional `deprecated?: boolean`, `deprecatedReason?: string`, and `replacementProfiles?: string[]`. The catalog at `generator/profiles.json` MUST be validated for unique profile ids, known feature ids, transitive dependency satisfaction, conflict freedom, cycle freedom, deterministic ordering, and replacement validity.

#### Scenario: Validator catches invalid replacement

- **WHEN** a profile declares `deprecated: true` with `replacementProfiles: ["nonexistent"]`
- **THEN** `bun run generator:validate` exits non-zero and reports `unknown-profile` for the replacement

### Requirement: Platform profile is the complete feature set

The `platform` profile SHALL contain exactly the union of all currently supported features except those explicitly declared deferred/incompatible (`dynamicRoles`). The validator SHALL enforce this invariant so adding a new feature requires updating `platform`.

#### Scenario: New feature not added to platform is caught

- **WHEN** a new feature `newFeature` is added to `features.json` without adding it to `platform.features`
- **THEN** `bun run generator:validate` reports that `platform` does not represent the complete feature set

### Requirement: Validation verifies deterministic ordering and uniqueness

The validator SHALL enforce that profile ids are unique, feature ids within each profile are sorted deterministically, and the overall catalog order is stable.

#### Scenario: Unsorted profile features detected

- **WHEN** a profile lists features in non-alphabetical order (e.g., `["auth","persistence"]`)
- **THEN** `bun run generator:validate` reports an ordering violation

```
