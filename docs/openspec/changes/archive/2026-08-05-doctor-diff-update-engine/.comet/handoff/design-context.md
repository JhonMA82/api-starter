# Comet Design Handoff

- Change: doctor-diff-update-engine
- Phase: design
- Mode: compact
- Context hash: 273717f5011b8b964e74994bea872b08d1fd24721a041e04e8176fdc3e0906d7

Generated-by: comet-handoff.sh

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## docs/openspec/changes/doctor-diff-update-engine/proposal.md

- Source: docs/openspec/changes/doctor-diff-update-engine/proposal.md
- Lines: 1-30
- SHA256: e7bfa515ca7b34796f1a6aa46f0a325cb11c25c7bb735d624faf5b8896b9705b

```md
## Why

Once `.api-starter/manifest.json` exists, projects need safe diagnostics and upgrades without silently overwriting customizations. Today `add:feature` is the only post-generation mutation and there is no way to propagate security fixes, template corrections, or middleware improvements to already-generated projects. A materialize-compare-classify engine with `doctor`, `diff` and `update` is required, honoring baseline hashes and never overwriting personalized files.

## What Changes

- Add `generator/src/materialize.ts` shared engine (if not already landed via manifest change) exposing `materializeToTemp(plan): string` that writes a canonical project tree for exactly the manifest's feature set.
- Add `generator/src/hashing.ts` helpers reused by the engine.
- Add `generator/src/file-strategies.ts` with conservative handlers for JSON (`package.json` managed keys), env (`.env.example` key-wise), and YAML/text fallback to generated-region or managed classification; no fragile regex YAML edits.
- Add `generator/src/update-plan.ts` that classifies each path by comparing `baselineHash`, `currentContentHash`, and `canonicalNextHash` into: `add`, `update-safe`, `remove-safe`, `unchanged`, `customized-no-upstream-change`, `conflict`, `manual-migration`, per spec §10 table, and produces a deterministic operation list.
- Implement `generator:doctor` (`generator/src/project-doctor.ts`): checks manifest presence/validity, schema support, starter version/features validity, missing/modified managed files, extra untracked files (advisory), stale hashes, unapplied migrations, composition mismatches, residual files from disabled features, and git dirty warning; supports `--json`.
- Implement `generator:diff` (`generator/src/diff-project.ts`): read-only, materializes target version to temp, lists safe/conflict/manual ops with reasons, exits non-zero on conflict/invalid state, supports `--json`, no network needed when run from target checkout.
- Implement `generator:update` (`generator/src/update-project.ts`): dry-run without `--apply`, respects conflicts (no global `--force` that destroys customizations), creates backup per touched file under `.api-starter/backups/<timestamp>/`, deterministic apply, runs post-validations (`typecheck`/`test` or configured), auto-rollback on failure without manifest bump, manifest update only on full success, idempotent second run.
- Add scripts `generator:doctor`, `generator:diff`, `generator:update` (and retain `generator:adopt`) in `package.json`.

## Capabilities

### New Capabilities
- `generator-doctor`: project health diagnostics without mutation, with human and JSON output.
- `generator-diff`: read-only upgrade preview with classification and non-zero exit on conflicts.
- `generator-update`: safe, atomic, rollback-aware update executor.

### Modified Capabilities
<!-- None - additive tooling -->

## Impact

- Affects: `generator/src/*` (new files), `package.json` scripts, `docs/architecture.md`, `docs/updating-generated-projects.md` (intro), `generator/tests/*`.
- CLI contract: four new commands with `--project` and `--to`/`--apply`/`--json` flags; `diff` and `update` share engine.
- No runtime imports in `apps/api`/`packages`/`modules`; engine is generator tooling only.

```

## docs/openspec/changes/doctor-diff-update-engine/design.md

- Source: docs/openspec/changes/doctor-diff-update-engine/design.md
- Lines: 1-63
- SHA256: 431af0ccbfe07b8ac1974daf8b8605e30038cce6efeaae4186faffcb40e77f68

```md
## Context

See proposal. This change depends on the manifest (schemaVersion 1, baselineHash, strategy) and materialize helper. The engine must not copy the repo blindly; it must reason file-by-file and support structured merges.

Constraints: domain←application←http preserved; updater must not contaminate API runtime; no secret logging; determinism and idempotency.

## Goals / Non-Goals

**Goals:** Materialize-compare-classify loop, doctor/diff/update with backup/rollback, safe file strategies, human+JSON output, deterministic/typed.

**Non-Goals:** Versioned migration registry/sequencing (next change), governance ADR, generated/extensions separation beyond strategy tagging, executing destructive DB migrations.

## Decisions

### Decision 1: Materialize to temp
- **Choice:** `materializeToTemp(plan): string` creates `fs.mkdtempSync(os.tmpdir()+"/api-starter-canonical-")`, calls shared `materializeProject`, returns path. Caller cleans up via `try/finally` and `rmSync`.
- **Rationale:** Enables diff/update to get byte-exact canonical output without polluting user's project; uses same planner so --features custom compositions are honored.
- **Alternative:** Diff against git history - rejected (no guarantee of feature-set fidelity).

### Decision 2: Classification table
- **Choice:** In `update-plan.ts`, for each path in union(baseline keys, current fs, canonical next):
  - if new in next && missing locally → `add`
  - if current==baseline && next!=baseline → `update-safe`
  - if next missing && current==baseline && locally exists → `remove-safe`
  - if current==next → `unchanged`
  - if current!=baseline && next==baseline → `customized-no-upstream-change` (keep)
  - if current!=baseline && next!=baseline && current!=next → `conflict`
- Plus `manual-migration` when file is birth in tenant-scoped migration needing data review.
- **Rationale:** Exactly spec §10 table; trivial to test deterministically.

### Decision 3: File strategies
- **Managed:** byte replace if update-safe, otherwise conflict.
- **Structured JSON:** parse and shallow-merge only managed keys. For `package.json`: manage `dependencies`/`devDependencies` keys that are `@consulting/*` or `drizzle-*` plus `workspaces`? Preserve user scripts/deps outside that set. For `tsconfig.json`, manage `compilerOptions.paths` for workspaces only. For `.env.example`, key-wise merge: add required by new features, remove only if previously managed and now unused and not customized.
- **Env:** never touch `.env`; only `.env.example`.
- **YAML/text:** Prefer real parser if available (js-yaml) else generated-region markers. Since adding a parser is a pin, start with region approach and document.

### Decision 4: Doctor / Diff / Update CLI shapes
- **doctor:** args `--project=path` (default `.`), `--json`. Checks: manifest missing/invalid, schema unsupported, unknown starter version/feature/conflict, missing managed file, hash mismatch (modified), stale appliedUpdates, composition residual (prune list present), git dirty (`git status --porcelain` non-empty → warning not error). Output: array of issues `{code, path, severity, message, suggestion}`. Exit 0 if only warnings/extra untracked files; non-zero on errors.
- **diff:** args `--project`, `--to=<version>` (target manifests version not used to checkout but to materialize? For now materializes with current generator's catalog; --to validated as SemVer but not yet network-fetched). Read-only, prints classification tables. Exit 1 on any conflict.
- **update:** args `--project`, `--to`, `--apply` (without apply = dry-run), no global --force. Steps: build plan via diff engine → if conflicts and not explicit per-file --include → abort; backup to `.api-starter/backups/<iso>/`; apply `add`/`update-safe`/`remove-safe` deterministically sorted; run `bun x tsc --noEmit` and `bun test` inside project (with timeout); on failure restore from backup and do not bump manifest; on success update `managedFiles` baselineHashes, `starter.version` to target, push to `appliedUpdates`, bump `updatedAt`, write atomically.

### Decision 5: Backup and rollback
- **Choice:** Before writing, `copyFileSync` current file to backup dir for each `update-safe`/`remove-safe`/`add` target. On post-validation failure, restore each backup and delete adds.
- **Rationale:** Reversible without git.

### Decision 6: Validation hooks
- **Choice:** Post-update runs `bun x tsc --noEmit` (quick) and optionally `bun test --runInBand` only if project has tests. Controlled by manifest's `postUpdateValidations` field (future). For now always typecheck, test if in profile.
- **Alternative:** No validations - rejected (spec requires them).

## Risks / Trade-offs

- **[Risk] Post-validation may be slow** → Mitigation: doctor/diff separate cheap checks; update validations run only on apply.
- **[Risk] Structured merge incomplete for complex YAML** → Mitigation: fall back to generated-region marker rather than fragile regex.
- **[Risk] Backup directory clutter** → Mitigation: under `.api-starter/backups/` which can be gitignored and pruned manually.

## Migration Plan

- Steps: create hashing/materialize/file-strategies/update-plan, then doctor/diff/update CLIs, add package scripts, write tests, run lint/typecheck/test.
- Rollback: remove new scripts; no runtime residue.

## Open Questions

- None.

```

## docs/openspec/changes/doctor-diff-update-engine/tasks.md

- Source: docs/openspec/changes/doctor-diff-update-engine/tasks.md
- Lines: 1-22
- SHA256: 4b3b284a38a955371d9fa18238b3e8259e7f037fdd1aeb2f9686dcba3e6b6f07

```md
## 1. Engine foundations

- [ ] 1.1 Implement `generator/src/hashing.ts` SHA-256 helpers and `generator/src/materialize.ts` `materializeToTemp` sharing logic with `create-project.ts` (if not already landed)
- [ ] 1.2 Implement `generator/src/file-strategies.ts` with strategies `managed`/`structured`/`scaffold`/`generated-region`/`ignored`; add JSON key-wise merge for `package.json`/`tsconfig.json` and env-key merge for `.env.example` (never `.env`)
- [ ] 1.3 Implement `generator/src/update-plan.ts` with classification table (add/update-safe/remove-safe/unchanged/customized-no-upstream-change/conflict/manual-migration) deterministically sorted

## 2. Doctor and Diff

- [ ] 2.1 Implement `generator/src/project-doctor.ts` (`generator:doctor`) with all checks listed in proposal, human + `--json` output, correct exit codes and git-dirty warning
- [ ] 2.2 Implement `generator/src/diff-project.ts` (`generator:diff`) read-only: materialize target, build plan via `update-plan.ts`, explain reasons, `--json`, non-zero on conflict/invalid, no writes verification

## 3. Update with safety

- [ ] 3.1 Implement `generator/src/update-project.ts` (`generator:update`) dry-run vs `--apply`, conflict abort (no global --force), backup under `.api-starter/backups/<ts>/`, deterministic apply
- [ ] 3.2 Add post-validation hooks (typecheck, tests) with automatic rollback on failure and manifest bump only on full success
- [ ] 3.3 Ensure idempotency: second apply after success reports unchanged and performs no writes

## 4. Tests and docs

- [ ] 4.1 Tests: clean project, modified managed file, missing file, extra untracked advisory, corrupt manifest, diff without writes, JSON validity, exit codes, update intact/preserved/conflict/add/remove-safe/merge-package.json/env handling/rollback/idempotency/custom-based project
- [ ] 4.2 Docs: `docs/updating-generated-projects.md` intro section and `docs/architecture.md` update strategy paragraph
- [ ] 4.3 Run `bun run lint/typecheck/test` and diff/update dry-run fixtures with real customizations

```

## docs/openspec/changes/doctor-diff-update-engine/specs/generator-diff/spec.md

- Source: docs/openspec/changes/doctor-diff-update-engine/specs/generator-diff/spec.md
- Lines: 1-34
- SHA256: cd0b37597dcb481186e9d094cb69f4475b64979bdbc86e43ee70e2b143bfffb8

```md
## Purpose

Shows a safe, read-only preview of what would change when upgrading a project to a newer starter version, classifying each file as safe or conflicting.

## ADDED Requirements

### Requirement: Diff is read-only and classification-complete

`generator:diff -- --project=<dir> --to=<version>` SHALL materialize the canonical target for exactly the project's feature set, classify every path as `add`, `update-safe`, `remove-safe`, `unchanged`, `customized-no-upstream-change`, `conflict`, or `manual-migration`, explain per-file why it is a conflict, exit non-zero when any conflict or invalid state exists, support `--json`, and require no network when run from the target starter checkout.

#### Scenario: Intact file shows update-safe

- **WHEN** upstream `apps/api/src/http/logger.ts` changed between baseline and target but local file equals baselineHash
- **THEN** diff lists that file as `update-safe`

#### Scenario: Customized file with upstream change shows conflict

- **WHEN** local file differs from baselineHash and upstream canonical also differs from baseline
- **THEN** diff lists it as `conflict` with reason "locally customized and upstream also changed; not overwritten"

#### Scenario: Diff does not write

- **WHEN** diff runs
- **THEN** no file under `--project` is modified (verified by hashing before/after)

### Requirement: Diff --json is machine-readable

`--json` SHALL emit a top-level object `{ project, to, fromVersion, toVersion, files: [{ path, classification, reason, strategy }] , migrations?: [...] }` with stable ordering.

#### Scenario: CI parses diff JSON

- **WHEN** `generator:diff -- --project=/tmp/proj --to=0.3.0 --json` runs
- **THEN** its stdout is valid JSON matching the schema and contains no colors or human prose mixed in


```

## docs/openspec/changes/doctor-diff-update-engine/specs/generator-doctor/spec.md

- Source: docs/openspec/changes/doctor-diff-update-engine/specs/generator-doctor/spec.md
- Lines: 1-30
- SHA256: 3378ad123147f16b76edbc3a41083d08508b26f448ae04cc0f55b89e88095441

```md
## Purpose

Detects drift, customization and configuration errors in generated projects without mutating them, so users can decide safely before updating.

## ADDED Requirements

### Requirement: Doctor detects core invalid states

`generator:doctor -- --project=<dir>` SHALL detect at least: missing/invalid manifest, unsupported schemaVersion, unknown starter version, invalid/conflicting features, missing managed file, modified managed file (hash mismatch), stale hashes, declared but unapplied migrations, inconsistent composition vs features, verifiable residual files from disabled features, and git dirty as warning not error. It SHALL output human text by default and `--json` as structured array.

#### Scenario: Clean project passes

- **WHEN** doctor runs on a freshly materialized `platform` project with manifest intact
- **THEN** it exits zero reporting no errors (only optional extra untracked files advisories), and `--json` output is parseable and empty for errors

#### Scenario: Modified managed file flagged

- **WHEN** `apps/api/src/app.ts` (strategy managed) is edited after generation
- **THEN** doctor reports that path with code `managed-modified` and severity error, noting baseline vs current hash mismatch

#### Scenario: Missing managed file flagged

- **WHEN** a managed file is deleted
- **THEN** doctor reports `managed-missing` error for that path

#### Scenario: Git dirty is warning only

- **WHEN** the project has uncommitted changes but manifest issues are otherwise clean
- **THEN** doctor reports a `git-dirty` warning but still exits zero


```

## docs/openspec/changes/doctor-diff-update-engine/specs/generator-update/spec.md

- Source: docs/openspec/changes/doctor-diff-update-engine/specs/generator-update/spec.md
- Lines: 1-39
- SHA256: 0476e3eab72e378b088a0b6aab7194ff348dba679922e5b5a07dc0e51772a648

```md
## Purpose

Applies safe upstream changes to a project without overwriting personalizations, with backup, validation and rollback guarantees.

## ADDED Requirements

### Requirement: Update respects customizations and is explicit

Without `--apply`, `generator:update` SHALL operate as dry-run (same output as diff). With `--apply` it SHALL NOT overwrite any file classified as `conflict` or `customized-no-upstream-change`, SHALL NOT expose a global destructive `--force`, SHALL abort by default when conflicts exist, SHALL create a backup per touched file under `.api-starter/backups/<timestamp>/` ignored by Git, SHALL apply operations deterministically sorted, SHALL run post-validations (typecheck/tests) and on failure SHALL revert touched files and SHALL NOT bump the manifest.

#### Scenario: Dry-run does not mutate

- **WHEN** `generator:update -- --project=/tmp/proj --to=0.3.0` (no --apply) on a project with an `update-safe` file
- **THEN** the project's file stays at baseline hash and exit code is zero (or non-zero if conflicts exist - matching diff semantics)

#### Scenario: Conflict prevents apply

- **WHEN** a project has at least one `conflict` file and `generator:update -- --project=/tmp/proj --to=0.3.0 --apply` is run
- **THEN** no file is overwritten, backups are not created, and the command exits non-zero listing the conflicting paths

#### Scenario: Successful update bumps manifest only on success

- **WHEN** only `update-safe`/`add`/`remove-safe` operations exist and post-validations pass and `--apply` is given
- **THEN** the listed files are updated to target canonical content, `.api-starter/manifest.json` is updated to new baselineHashes and `updatedAt`/`starter.version`, and a second run reports no changes (idempotent)

#### Scenario: Failed post-validation rolls back

- **WHEN** an update would introduce a type error and `bun x tsc --noEmit` fails post-apply
- **THEN** the updater restores all touched files from backups, leaves the manifest unchanged from before the run, and exits non-zero

### Requirement: Structured files are merged not overwritten

For files with strategy `structured`, `generator:update` SHALL parse and merge only managed keys (e.g., keep user scripts/deps in `package.json`, key-wise merge in `.env.example`), preserve foreign keys, and order only managed sections without reformatting the entire file unnecessarily. It SHALL never modify `.env`.

#### Scenario: Package.json merge preserves user script

- **WHEN** `package.json` has a user-added script `my:script` and upstream adds a new dependency
- **THEN** after `generator:update --apply`, `my:server` (user's) remains, upstream dep is added, and user script is not removed


```
