# Comet Design Handoff

- Change: versioned-manifest-adopt
- Phase: design
- Mode: compact
- Context hash: 4eeeb1ee30f2442b3adedc0253051b0f9524031e4c28054b0b8a6bd5bae9f6f9

Generated-by: comet-handoff.sh

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## docs/openspec/changes/versioned-manifest-adopt/proposal.md

- Source: docs/openspec/changes/versioned-manifest-adopt/proposal.md
- Lines: 1-30
- SHA256: ef9e3fa98bab8759b21f53329751cd0d971239bcc82f1cad53e0050ecc2fecf9

```md
## Why

`GENERATED.md` is human-readable and currently parsed as the machine source of truth, which is fragile for automation. To support safe, deterministic updates (doctor/diff/update) and idempotent re-generation, projects need a machine-readable, versioned manifest with stable hashes, file strategies, and applied-updates history. Existing projects with only `GENERATED.md` need an explicit adoption path that validates and hashes before writing.

## What Changes

- Introduce `.api-starter/manifest.json` as the canonical manifest with stable ordered keys:
  `schemaVersion` (current 1), `starter` { name, version, sourceRevision? }, `generation` { profile, features[], createdAt, updatedAt }, `managedFiles` { "<relative>": { baselineHash: "sha256:...", strategy: "managed"|"structured"|"scaffold"|"generated-region"|"ignored" } }, `appliedUpdates` []
  plus support for future migration tracking fields.
- Implement `generator/src/manifest.ts` with strict schema validation, actionable errors, atomic temp→rename writes, stable key ordering, unknown-feature and future-schema rejection, and no silent repair.
- Implement `generator/src/hashing.ts` (SHA-256 stable, hex, `sha256:` prefix) and `generator/src/materialize.ts` thin wrapper that materializes a `ProjectPlan` to a target dir without mutating caller.
- Generate new projects with both `.api-starter/manifest.json` (machine) and `GENERATED.md` (human derived view). `add:feature` migrates to update the manifest atomically as well as `GENERATED.md`.
- Keep legacy `GENERATED.md` read path for at least one version with a deprecation warning; do not parse it indefinitely as system source.
- Add `bun run generator:adopt -- --project=../legacy-api --baseline=0.1.0` that reads legacy marker only as migration input, validates profile/features against catalog, compares known files vs. baseline, reports divergences as customized/conflicting, and creates the manifest only when state is sufficiently verifiable. No guessing of baseline version.
- Exclude secrets, `.env`, DBs, build artifacts, and foreign lockfiles from managedFiles; record only starter-owned paths.

## Capabilities

### New Capabilities
- `generator-manifest`: versioned manifest creation, atomic persistence, validation, and hashing contract.
- `generator-adopt`: legacy adoption workflow that migrates `GENERATED.md` projects to the manifest with verifiable hashing and divergence reporting.

### Modified Capabilities
<!-- None - new behavior, not modification of existing specs -->

## Impact

- Affects: `generator/src/manifest.ts`, `generator/src/hashing.ts`, `generator/src/materialize.ts`, `generator/src/adopt-project.ts`, `generator/src/create-project.ts` (manifest emission), `generator/src/add-feature.ts` (manifest update), `generator/profiles.json` ordering guarantees, `package.json` scripts, `docs/architecture.md`.
- CLI: new `generator:adopt` script; existing `create:project` and `add:feature` behavior extended.
- No runtime `apps/api` changes beyond ensuring `.api-starter/` is gitignored-agnostic and not shipped as package dependency.

```

## docs/openspec/changes/versioned-manifest-adopt/design.md

- Source: docs/openspec/changes/versioned-manifest-adopt/design.md
- Lines: 1-56
- SHA256: 4c54a958cc21e0242a5ef19fcb94d0c86b9c2b2d2307ff114d8a635e2f4a2507

```md
## Context

See proposal. Current repo uses `GENERATED.md` marker and `planProject`/`computeRemoveList`. No `.api-starter/manifest.json`, no hashing, no atomic manifest writer, no materialize abstraction. `add:feature` mutates project files directly and bumps `GENERATED.md` string.

Constraints: domain←application←http preserved; generator must not import Hono/Bun; atomic writes required; deterministic ordering; no secret logging.

## Goals / Non-Goals

**Goals:** Introduce manifest schema 1, atomic read/write, SHA-256 stability, materialize helper, adopt flow with divergence report, keep GENERATED.md as derived view, update add:feature to use manifest.

**Non-Goals:** Full doctor/diff/update classification (next change), migration registry, structured-file semantic merging beyond detection, governance docs.

## Decisions

### Decision 1: Schema layout
- **Choice:** `generator/src/manifest.ts` exports Zod-like strict validator (hand-rolled to avoid new dep) with interface `Manifest { schemaVersion: 1, starter:{name,version,sourceRevision?}, generation:{profile, features, createdAt, updatedAt}, managedFiles: Record<string,{baselineHash,strategy}>, appliedUpdates: string[] }`.
- **Rationale:** Simple JSON, no extra dependency, strict actionable errors.
- **Alternative:** Zod - rejected to keep `packages/*` zero deps.

### Decision 2: Hashing
- **Choice:** `generator/src/hashing.ts` uses `node:crypto` `createHash('sha256')`, returns `sha256:<hex>`, stable by reading file as utf8 bytes (for text) and sorting manifest keys before stringify.
- **Rationale:** Matches spec §7.1 SHA-256 stable, no FS timestamps.

### Decision 3: Materialize abstraction
- **Choice:** `generator/src/materialize.ts` exposes `materializeProject(plan: ProjectPlan, outDir: string)` that reuses `create-project.ts` copy/prune/write logic but accepts a plan rather than profileId. Both `create:project` and future `diff/update` call it.
- **Rationale:** Single materialization prevents drift; spec §10 explicitly says `create:project` and `generator:update` must share same materialization.
- **Alternative:** Duplicate logic - rejected.

### Decision 4: Manifest write strategies
- Strategy tags decided per file extension/path:
  - `managed`: most generated files (`apps/api/src/app.ts`, `routes.ts`, package rewrites result) - replace only if hash matches.
  - `structured`: `package.json`, `tsconfig.json`, `.env.example`, `drizzle.config.ts` - not replaced wholesale; handled by future file-strategies but tagged structured now.
  - `scaffold`: `scripts/db/*` where existence matters once - tagged scaffold, never auto-updated.
  - Computed at materialization time via `file-strategies.ts` stub.

### Decision 5: Adopt flow
- **Steps:** parse GENERATED.md regex `/profile:\s*(\S+)/` and `/features:\s*(.*)/`, validate via `validateFeatureSet`, materialize baseline version to temp dir using `planFeatureSet` (requires that baseline version's generator produce same file), hash-compare each managed file, build report categories: intact, customized-no-upstream, missing. Only write manifest if no unrecoverable error (missing GENERATED.md or unknown baseline). Divergent files recorded with current hash but note they are customized.
- **Atomicity:** `writeManifest(projectDir, manifest)` writes to `.api-starter/manifest.json.tmp` then `renameSync`.
- **Stable keys:** `JSON.stringify` with sorted keys helper.

### Decision 6: Legacy compat
- Keep reading GENERATED.md in `readManifestOrLegacy()` that first tries manifest, falls back to parsing GENERATED.md with warning to stderr. The warning mentions `bun run generator:adopt -- --project=<dir> --baseline=<version>`.

## Risks / Trade-offs

- **[Risk] Creating canonical baseline for old version may require checking out tag** → Mitigation: adopt docs say run from target starter checkout; implementation assumes current code can materialize approximate baseline (best-effort) and marks mismatches as customized rather than failing.
- **[Risk] .api-starter directory surprises .gitignore** → Mitigation: intentionally not gitignored; manifest is committed to allow drift detection. Add docs clarifying.

## Migration Plan

- Steps: create hashing.ts, manifest.ts, materialize.ts, adopt-project.ts, wire create-project to emit manifest, update add-feature to patch manifest, add tests, run `bun run lint/typecheck/test`.
- Rollback: delete `.api-starter/manifest.json` emission; legacy path still works.

## Open Questions

- None.

```

## docs/openspec/changes/versioned-manifest-adopt/tasks.md

- Source: docs/openspec/changes/versioned-manifest-adopt/tasks.md
- Lines: 1-24
- SHA256: cf261cd7abf4c5f9d3aaacd09f41db490cc3deb097b58cce6a0e030c111d06e8

```md
## 1. Manifest infrastructure

- [ ] 1.1 Implement `generator/src/hashing.ts`: SHA-256 `sha256:` hex, stable file hashing, helper for string hashing with tests
- [ ] 1.2 Implement `generator/src/manifest.ts`: strict schema v1, interfaces, readManifest/writeManifest atomically, stable key ordering, validation for unknown features/future schema, no silent repair
- [ ] 1.3 Implement `generator/src/materialize.ts`: pure materialization accepting ProjectPlan, shared by create-project and future diff/update; extract copy/prune/rewrite/template logic without duplication

## 2. Generation and add-feature integration

- [ ] 2.1 Wire `generator/src/create-project.ts` to emit `.api-starter/manifest.json` after successful materialization (with baseline hashes) while keeping `GENERATED.md` as derived human view
- [ ] 2.2 Update `generator/src/add-feature.ts` to read/update manifest atomically (features, hashes, updatedAt) and retain `GENERATED.md` sync; handle legacy fallback with deprecation warning
- [ ] 2.3 Ensure managedFiles excludes secrets/.env/lockfile/build artifacts per spec §7.1

## 3. Adopt legacy projects

- [ ] 3.1 Implement `generator/src/adopt-project.ts` for `generator:adopt` CLI: parse GENERATED.md, validate profile/features, compare vs baseline via materialize+hash, generate divergence report, write manifest only when verifiable, never guess baseline
- [ ] 3.2 Add CLI arg handling for `--project` and `--baseline`, reporting categories intact/customized/missing before write
- [ ] 3.3 Preserve legacy read path with deprecation warning for one version in manifest.ts/read helper

## 4. Tests and docs

- [ ] 4.1 Tests: valid creation, stable serialization, future schema rejection, unknown feature rejection, hash stability, atomic write, add:feature manifest update, legacy read with warning, adopt with divergences
- [ ] 4.2 Docs: update `docs/architecture.md` manifest section and README generation docs
- [ ] 4.3 Baseline: `bun run lint/typecheck/test` and manifest generation for each profile to /tmp verifies hashes deterministic


```

## docs/openspec/changes/versioned-manifest-adopt/specs/generator-adopt/spec.md

- Source: docs/openspec/changes/versioned-manifest-adopt/specs/generator-adopt/spec.md
- Lines: 1-41
- SHA256: 3d6cd4009186079fef9c95051a76a28b6ef2f89570ea24436e1d0aabb8f46733

```md
## Purpose

Allows existing projects that only have `GENERATED.md` to migrate to the new versioned manifest with a verifiable, non-guessy adoption flow.

## ADDED Requirements

### Requirement: Adopt reads legacy marker only as migration input

`generator:adopt` SHALL read `GENERATED.md` only to extract legacy `profile` and `features`, validate them against the current catalog (rejecting unknown/conflicting sets), compare known files against the declared baseline version's canonical hashes, generate a pre-write report, and create `.api-starter/manifest.json` only if state is sufficiently verifiable.

#### Scenario: Legacy project adoption succeeds

- **WHEN** `bun run generator:adopt -- --project=/tmp/legacy --baseline=0.10.1` where legacy has unmodified files
- **THEN** it prints a report showing each known file as "intact" vs "customized", then writes a valid manifest with baselineHash equal to current content for intact files and notes customized ones

### Requirement: Divergent files are marked customized, not assumed intact

Any managed file whose current hash differs from the baseline canonical hash SHALL be recorded in the manifest as customized/conflicting context (not as intact), and the report SHALL list it with reason.

#### Scenario: Customized file adoption

- **WHEN** the legacy project modified `apps/api/src/app.ts`
- **THEN** `generator:adopt` reports that file as divergent/customized and does not set its baselineHash to the current divergent content as if it were canonical

### Requirement: Adoption does not guess baseline

If baseline cannot be proven (missing/ambiguous `GENERATED.md` markers, unknown baseline version, or inability to materialize that version's canonical tree), `generator:adopt` SHALL fail with an actionable error and SHALL NOT write a manifest.

#### Scenario: Unknown baseline guessed is rejected

- **WHEN** `generator:adopt -- --project=/tmp/legacy` is run without `--baseline` and `GENERATED.md` lacks a decipherable version
- **THEN** it exits non-zero stating baseline version is required and does not write a manifest

### Requirement: Legacy read support with deprecation warning

For at least one version, `add:feature` and `doctor` SHALL still be able to read `GENERATED.md` when no manifest exists, but SHALL emit a deprecation warning advising to run `generator:adopt`.

#### Scenario: Tool reads legacy project with warning

- **WHEN** a tool runs against a `GENERATED.md`-only project
- **THEN** it prints a deprecation warning referencing `generator:adopt` and proceeds (if behavior is still supported), rather than failing silently

```

## docs/openspec/changes/versioned-manifest-adopt/specs/generator-manifest/spec.md

- Source: docs/openspec/changes/versioned-manifest-adopt/specs/generator-manifest/spec.md
- Lines: 1-47
- SHA256: ae468f99fa1a19cb5e452df8b7cd5e2b7e3e05ff2d3d9d68c2ff4e38828347e0

```md
## Purpose

Provides a stable, versioned machine-readable manifest that records starter version, feature set and baseline hashes so tooling can deterministically compare and update projects.

## ADDED Requirements

### Requirement: Manifest file is generated for new projects

For every newly materialized project, the generator SHALL write `.api-starter/manifest.json` with schemaVersion=1, starter { name:"@consulting/api-starter", version: "<exact package.json version>", sourceRevision?: git commit when available }, generation { profile: string, features: string[] sorted, createdAt/updatedAt ISO-8601 }, managedFiles { "<rel>": { baselineHash, strategy } }, appliedUpdates: []. The file SHALL have stable key and array ordering, and be written atomically via temp file + rename.

#### Scenario: New project contains valid manifest

- **WHEN** `bun run create:project -- --profile=minimal --out=/tmp/min` completes
- **THEN** `.api-starter/manifest.json` exists, validates against the strict schema, has baselineHash entries for each managed file matching SHA-256 of the generated content, and `GENERATED.md` still exists as a human view

#### Scenario: Manifest rejects future schema

- **WHEN** reading a manifest with `schemaVersion: 999`
- **THEN** the tool exits with an actionable error mentioning unsupported schema version and does not silently repair

### Requirement: Hash stability and strategy tagging

Every managed file entry SHALL include `baselineHash` as `sha256:<hex>` of the canonical generated content and `strategy` one of `managed`, `structured`, `scaffold`, `generated-region`, `ignored`. Secrets, `.env`, lockfiles foreign to starter, build artifacts and DB files SHALL NOT be recorded.

#### Scenario: Hash is stable across regenerations

- **WHEN** the same profile is materialized twice to two temp dirs
- **THEN** the SHA-256 hashes for each corresponding managed file are byte-identical

### Requirement: Strict validation and no silent repair

Reading the manifest SHALL validate: schemaVersion known, starter.version present, features all known and conflict-free, profile known, dates ISO-8601, managedFiles keys well-formed, and SHALL reject with actionable messages without attempting silent repair of corrupted JSON.

#### Scenario: Corrupt manifest rejected

- **WHEN** `generator:doctor` reads a truncated JSON manifest
- **THEN** it reports "manifest is corrupt" with the JSON parse error and does not overwrite the file

### Requirement: Add-feature updates manifest atomically

Running `add:feature` on a manifest-bearing project SHALL update `generation.features`, `managedFiles` hashes for affected files, and `generation.updatedAt`, writing atomically with stable ordering, only after successful materialization.

#### Scenario: Add feature bumps manifest

- **WHEN** `bun run add:feature -- --feature=tenancy --project=/tmp/proj` succeeds on a project generated with `authenticated`
- **THEN** the manifest's features array now includes `tenancy` sorted, its relevant managedFiles hashes updated, and the file was written via atomic rename (no partial write)


```
