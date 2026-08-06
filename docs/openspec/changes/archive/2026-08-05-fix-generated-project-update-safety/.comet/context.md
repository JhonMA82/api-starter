# Comet Design Handoff

- Change: fix-generated-project-update-safety
- Phase: design
- Mode: compact
- Context hash: 5694a6c9d8164e18bc2d36edf7f1d868ab107104694ccab59865ff171fd8eab6

Generated-by: comet-handoff.sh

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## docs/openspec/changes/fix-generated-project-update-safety/proposal.md

- Source: docs/openspec/changes/fix-generated-project-update-safety/proposal.md
- Lines: 1-34
- SHA256: d0f80c06f25af258169c355ab8b788c40610f92f6ccd75f92ea306ef2d629ac5

```md
## Why

External audit (2026-08-05, `OPENCODE_VERIFICAR_Y_CORREGIR_API_STARTER_VNEXT.md` O1–O8) claims the update machinery can mis-report versions, ignore the versioned registry, overwrite structured files, adopt with wrong hashes, validate only typecheck, and over-promise in docs. Before shipping 0.11.x, those claims must be reproducibly verified and, when confirmed, corrected with minimal, testable fixes that preserve the invariant: `api-starter` is a factory for independent APIs, not a private runtime framework. The fix must not introduce a complex migration framework, global `--force`, or hidden remote fetches.

## What Changes

- **O1 – Version truth:** Resolve canonical version from the starter's own `package.json` (not `process.cwd()` of the consumer), validate `--to` against that canonical version, derive `UpdatePlan.toVersion` and manifest bump solely from the verified canonical, and reject mismatches before any write.
- **O2 – Registry integration:** Make `diff`/`update` import and execute `resolveUpdatePath(from,to)`, surface update IDs/breaking notes/requiresManual/postValidations in dry-run, block `--apply` when the path is incomplete, a downgrade is requested, or a step requires manual work, apply steps in order, record each `id` once in `appliedUpdates`, and write the manifest only after all steps and validations succeed.
- **O3 – Structured dispatch:** Replace the TODO copy-through for structured files with an explicit dispatcher that invokes `mergePackageJson` / `mergeEnvExample` only for supported paths, fails closed on JSON parse errors, preserves consumer scripts/deps/metadata, and treats unsupported `structured` paths as `conflict`/`manual` rather than silently copying.
- **O4 – Adopt correctness:** Store `baselineHash` as the canonical baseline hash (never the local customized hash), use `getFileStrategy(rel)` for real strategy, report `customized` vs `intact` correctly, and reject `--baseline` values that cannot be materialized from the current checkout (no fake historical baselines).
- **O5 – Post-validations & rollback:** Run an allow-listed, timeout-bounded validation set (typecheck, lint, project tests) derived from available scripts and registry `postValidations`, capture failure detail, and trigger full file+manifest rollback on any failure; dry-run never executes validations.
- **O6/O7/O8 – Truth alignment:** Remove duplicated `STARTER_VERSION` / fallback drift, derive registry version from the single `package.json` source, classify non-trivial DB migration changes as `manual-migration` when no safe parser exists, and rewrite `docs/updating-generated-projects.md` to describe only implemented behaviour plus explicit limitations.
- **Deliverables:** `docs/verification-generated-project-update-vnext.md` with O1–O8 matrix (state + evidence), expanded unit/E2E suites in temp dirs, and updated generator scripts.

## Capabilities

### New Capabilities
- `generator-verification`: reproducible verification report and E2E harness for generated-project update safety (covers scenarios required by O1–O8 acceptance).

### Modified Capabilities
- `generator-diff`: bind `--to` to canonical version, include registry path/managed-vs-structured metadata, remain read-only.
- `generator-update`: integrate registry path, structured dispatch, extended validations, atomic manifest write, ordered step execution, rollback guarantees.
- `generator-adopt`: correct baselineHash/strategy handling and reject unmaterializable baselines.
- `generator-manifest`: single source of truth for starter version, no silent fallback to `0.10.1`, robust root resolution.
- `generator-updates`: real sequential execution from registry (ids, breakingNotes, requiresManual, postValidations) rather than documentation-only catalogue.
- `starter-governance`: version-source discipline and docs-truth alignment.
- `architecture-guardrails`: `api-starter` remains a code factory with no runtime dependency from generated projects.

## Impact

- **Code:** `generator/src/diff-project.ts`, `update-project.ts`, `update-plan.ts`, `materialize.ts`, `manifest.ts`, `file-strategies.ts`, `adopt-project.ts`, `generator/updates/registry.ts`, `project-doctor.ts`, `docs/updating-generated-projects.md`.
- **API/CLI:** `--to` becomes optional-or-must-match-canonical; mismatches exit non-zero before writes. No new global `--force`; structured merges preserve consumer keys. `appliedUpdates` records real IDs.
- **Docs:** `docs/updating-generated-projects.md` and `docs/verification-generated-project-update-vnext.md` updated; promises reduced where implementation stays conservative (e.g., DB migrations → manual).
- **Tests:** Unit + E2E suites under `generator/tests/` exercising version mismatch, downgrade, missing path, multi-step order, manual block, rollback, merge preservation, adopt hash, idempotency, dry-run purity, JSON stability; `bun test` must pass.

```

## docs/openspec/changes/fix-generated-project-update-safety/design.md

- Source: docs/openspec/changes/fix-generated-project-update-safety/design.md
- Lines: 1-85
- SHA256: fef5218768133b2526dddc47c5f3ab549e998f928d7ddfa35b7cd50598676420

[TRUNCATED]

```md
## Context

See `proposal.md` – Why. Current `generator/src/{diff-project,update-project,adopt-project,manifest,materialize,update-plan,file-strategies}` and `generator/updates/registry.ts` form a partially wired update engine: three-way hash classification exists but version truth, registry execution, structured dispatch, adopt hashing, and validation/rollback are under-connected or stubbed. Docs (`docs/updating-generated-projects.md`) describe a fuller engine (sequential migrations, safe structured merges, `typecheck/test`, deterministic journal) that is not yet enforced. The codebase already has deterministic hashing (`hashing.ts`), atomic manifest writes, and backup/rollback in `update-project.ts`. Constraint: remain a code factory – no runtime coupling, no global `--force`, no remote tag fetching.

## Goals / Non-Goals

**Goals:**
- Prove each O1–O8 claim against live code/tests before changing behaviour; record in `docs/verification-generated-project-update-vnext.md`.
- Fix only confirmed/partially-confirmed gaps with small deterministic functions, no framework sprawl.
- Make `diff`/`update`/`adopt`/`doctor` share one version-truth and one `resolveUpdatePath` authority.
- Preserve consumer customizations via tested merges for `package.json` and `.env.example`; fail closed otherwise.
- Keep `api-starter` as a factory: generated projects stay standalone.

**Non-Goals:**
- Remote tag/commit snapshot fetching or auto `db:migrate` execution.
- Full YAML/SQL parsers for arbitrary structured files.
- New IoC/DSL/plugin runtime or `api-starter` runtime dep in generated projects.
- Rewriting the generator; we augment existing modules only.

## Decisions

### D1 – Canonical version source
- **Choice:** Resolve starter root as `fileURLToPath(new URL("../../", import.meta.url))` (generator package root) and `git rev-parse --show-toplevel` fallback; read that directory's `package.json` synchronously at startup. Export `getCanonicalStarterVersion(): string` and `assertCanonicalMatchesRegistry()` helpers. `createManifest` and `getStarterVersion` delegate to it; `STARTER_VERSION` becomes `getCanonicalStarterVersion()` at import (or derived constant checked by test).
- **Alternatives:** `process.cwd()` (rejected – polluted by consumer cwd), env var (rejected – extra config), remote GitHub API (out of scope).
- **Rationale:** Single file truth, testable, no new dep; checkout-local verification matches conservative upgrade model from the audit.

### D2 – `--to` semantics
- **Choice:** `--to` remains accepted for compatibility but is *optional-and-must-match*. Implementation: `resolveTargetVersion(userTo: string | undefined): string` returns `canonical` if undefined, returns `canonical` if equal, otherwise throws `GenerationError("version mismatch: --to X != canonical Y")` before any temp dir. Dry-run and apply use the returned canonical for all outputs and manifest bumps.
- **Alternative:** Make `--to` mandatory vs truly optional; we do optional for ergonomics but documented as must-match when supplied.
- **Rationale:** Prevents manifest lies without breaking existing callers that pass `--to $(jq -r .version package.json)`.

### D3 – Registry integration without second generator
- **Choice:** `diff-project.ts` and `update-project.ts` import `resolveUpdatePath` and call it after version resolution. Result `Update[]` is rendered in JSON (`updatePath: [{id,from,to,breakingNotes,requiresManual,postValidations}]`) and human summary. If path empty and `from!==to` or throws, command fails pre-write. `--apply` blocked if any `requiresManual` non-empty or if classification includes `manual-migration`. On success, `appliedUpdates` appends each `Update.id` (deduped via `new Set([...existing, ...ids])`) only after validations pass.
- **Alternative:** Second generator driving registry migrations – rejected as overkill; we keep three-way comparison as primary engine, registry as validator/orchestrator.
- **Rationale:** Minimal change, tests already exercise `resolveUpdatePath`.

### D4 – Structured dispatch
- **Choice:** Introduce `applyFileOperation({operation, projectPath, canonicalPath, canonicalContent, currentContent})` dispatcher in `file-strategies.ts`. Handles: `managed→copy`, `structured + known path (package.json/.env.example)→merge*` (throw on parse error), `structured + unknown→throw "unsupported structured file → manual"` which caller reclassifies as `conflict`. `update-project.ts` replaces `copyFileSync` for `update-safe` with dispatcher and hashes final content.
- **`mergePackageJson` change:** On `catch` (invalid JSON) re-throw `GenerationError` instead of returning `nextContent`.
- **`mergeEnvExample`:** Already preserves order/comments; add dedup guard and ensure final newline.
- **Rationale:** Explicit, unit-testable; no silent overwrites; unknown structured files fail closed per audit.

### D5 – Adopt hash correction
- **Choice:** In `adopt-project.ts`, for each baseline entry compute `baselineHash = hashFileContent(baselineContent)` and `strategy = getFileStrategy(rel)`; compare with `projectHash` to label `intact` vs `customized` but store canonical hash in both cases. Add `assertBaselineMaterializable(baseline: string)` that checks `baseline === getCanonicalStarterVersion()` unless a fixture/snapshot map contains it; otherwise throw and do not write manifest.
- **Alternative:** Support arbitrary historical materialization via git worktrees – deferred; conservative to avoid lying about historical baselines.
- **Rationale:** Fixes three-way comparison; honest about limitation.

### D6 – Post-validations
- **Choice:** `runPostValidations(projectDir, extraValidations: string[])` runs allow-list map: `typecheck→"bun x tsc --noEmit"`, `lint→"bun run lint"` (skip if script missing → `not-applicable`), `test→"bun test --runInBand --bail"` filtered to managed tests, `manifest → validateManifest()`, `generator-smoke→"bun run generator:validate"`. Registry `postValidations` are unioned with base list. Each spawns with `timeout 30s`, captures output, returns `{ok, failedId, output}`. Any failure triggers rollback caller already has.
- **Alternative:** Arbitrary shell from manifest – rejected (security).
- **Rationale:** Deterministic, documented, tested; respects async nature.

### D7 – Version deduplication
- **Choice:** Remove fallback `"0.10.1"` in `createManifest`; replace with `getCanonicalStarterVersion()` or throw. Add sync test `generator/tests/catalog.test.ts` already does style but add `version-sync.test.ts` asserting `STARTER_VERSION === pkg.version === createManifest(...).starter.version` when run from starter root.
- **Rationale:** CI guard prevents drift.

### D8 – DB migration conservatism (O8 Route B)
- **Choice:** For now, classify any `migrations/*.sql` or `migrations/meta/_journal.json` changes that are non-trivial (name collision, removed upstream but customized, tenancy-related) as `manual-migration` → block apply, emit instructions. Do not auto-patch journal yet; document limitation.
- **Alternative:** Full journal parser – postpone to separate change after design spike.
- **Rationale:** Honesty over unsafe automation.

## Risks / Trade-offs

- **[Strict --to]** Users scripting `--to $(cat .api-starter/manifest.json)` that lags behind canonical will now fail fast → Mitigation: error message suggests running without `--to` or with canonical version; docs updated.
- **[Adopt restriction]** Legacy projects on `0.10.1` cannot adopt with `--baseline 0.10.1` until fixtures exist → Mitigation: document that only canonical baseline is materializable now; invite fixture PR for history.
- **[Structured narrow]** Most structured files beyond package.json/.env.example become conflicts → Mitigation: intentional; prevents data loss, surfaces need for explicit parsers later.
- **[Validation timeout]** Slow lint/test could exceed 30s in CI → Mitigation: timeout configurable via internal constant, not user flag; code defensively checks `existsSync(project/package.json scripts)`.
- **[Registry empty path]** One-entry registry (`0.10.1→0.11.0`) means jumps from older versions fail → Mitigation: expected; error indicates missing path and points to sequential requirement.
- **[Atomicity cost]** Per-file backups double I/O → Mitigation: only for `safeOps`, sorted deterministic, cleaned on success via timestamped dir under `.api-starter/backups`.

## Migration Plan

1. Land code fixes behind guarded helpers; keep CLI flags compatible.
2. Add unit tests first (version-sync, registry integration, merge dispatch) – they fail before fix, pass after.
3. Add `docs/verification-generated-project-update-vnext.md` during verification (pre-apply).
4. Update `docs/updating-generated-projects.md` and `CHANGELOG`/docs after code green.
5. Run `bun run lint`, `bun run typecheck`, `bun test` (incl. new E2E in temp dirs) in CI; smoke `TMP_ROOT=... create:project adopt diff update`.
6. No DB migration needed – this change touches only generator tooling.
7. Rollback: revert commit; no schema change. Failed `update --apply` already rolls back project state automatically, so upgrade hazard is low.


```

Full source: docs/openspec/changes/fix-generated-project-update-safety/design.md

## docs/openspec/changes/fix-generated-project-update-safety/tasks.md

- Source: docs/openspec/changes/fix-generated-project-update-safety/tasks.md
- Lines: 1-62
- SHA256: 82f83b25bb0c7b79f11484dda7dbcf7efcba32840f69628e2ac8fba04ea4288e

```md
## 1. Baseline and verification harness

- [ ] 1.1 Record baseline `git status --short`, branch `fix-generated-project-update-safety` (or current feature branch with isolation), `git log -1 --oneline`, `cat package.json` version, `bun --version` in `docs/verification-generated-project-update-vnext.md` preamble.
- [ ] 1.2 Run `bun run generator:validate`, `bun run lint`, `bun run typecheck`, `bun test` pre-change and log results; isolate pre-existing failures.
- [ ] 1.3 Create `docs/verification-generated-project-update-vnext.md` skeleton with table `| ID | Observation | State | Evidence | Action |` for O1–O8 and fill after each O-investigation.
- [ ] 1.4 Add temp-dir E2E helper `generator/tests/helpers/tmp-project.ts` (create minimal project, install manifest fixture, helpers for hash/file asserts) for isolated testing.

## 2. O1 – Canonical version truth

- [ ] 2.1 Add `generator/src/starter-version.ts` (or extend `manifest.ts`) with `getCanonicalStarterVersion(): string` resolving starter root via `import.meta.url` + `git rev-parse` fallback, reading that `package.json` version, throwing on missing.
- [ ] 2.2 Update `getStarterVersion()` and `createManifest()` to delegate to canonical helper; remove silent `0.10.1` fallback.
- [ ] 2.3 Add `resolveTargetVersion(userTo: string | undefined): string` that defaults to canonical or validates equality, throwing `GenerationError` on mismatch before materialization.
- [ ] 2.4 Wire `diff-project.ts` and `update-project.ts` to use `resolveTargetVersion`; make JSON `toVersion`, human header, `UpdatePlan.toVersion`, and manifest bump all use resolved canonical.
- [ ] 2.5 Add unit tests `generator/tests/version-truth.test.ts`: omitted --to defaults to canonical, matching --to passes, mismatched --to fails read-only without writes, `diff` and `update` report same canonical.

## 3. O2 – Registry path integration

- [ ] 3.1 Import `resolveUpdatePath` in `diff-project.ts`/`update-project.ts`; compute path after version resolve, include `updatePath` metadata in JSON and human dry-run.
- [ ] 3.2 Block on incomplete path, overshoot, downgrade, and `requiresManual` non-empty (before any file write); emit clear error and non-zero exit.
- [ ] 3.3 On `update --apply`, iterate `Update[]` in order, run optional `plan()` callbacks, collect per-step touched files for rollback, deduplicate `appliedUpdates` via Set, and write manifest only after all steps+validations succeed.
- [ ] 3.4 Extend registry with test-only fixtures for two-step path (via mock `UPDATES` in tests) and verify ordering.
- [ ] 3.5 Add tests `generator/tests/registry-integration.test.ts`: `from===to` empty idempotent, `0.10.1->0.11.0` resolves expected id, missing path rejected without writes, downgrade rejected, multi-step ordered, manual blocks, failure in step2 rolls back step1, ids recorded once.

## 4. O3 – Structured file dispatch

- [ ] 4.1 Extend `file-strategies.ts` with `applyFileOperation()` dispatcher and make `mergePackageJson` throw on JSON parse error instead of returning `nextContent`.
- [ ] 4.2 Update `update-plan.ts` to classify files with strategy `structured` but no safe merger as `conflict`/`manual-migration` with reason.
- [ ] 4.3 Replace TODO copy-through in `update-project.ts` for `update-safe` with dispatcher; hash final written content for `baselineHash`; surface `strategy` and merge type in dry-run output.
- [ ] 4.4 Add tests `generator/tests/file-strategies.test.ts` and `update-plan-structured.test.ts`: preserve local script/dep, add/update managed deps, remove retired managed dep, keep project name/metadata untouched, invalid JSON blocks + rollback, `.env.example` preserves local keys/comments/order/no duplicate on re-run, unsupported structured → conflict.

## 5. O4 – Adopt correctness

- [ ] 5.1 Fix `adopt-project.ts` to store `baselineHash: hashFileContent(baselineContent)` and `strategy: getFileStrategy(rel)` for every baseline file; label `intact` vs `customized` via hash compare but keep canonical hash.
- [ ] 5.2 Add `assertBaselineMaterializable(baseline: string)` guard (baseline must equal canonical or exist in fixtures snapshot map); fail without writing manifest if not materializable.
- [ ] 5.3 Report missing expected files explicitly and omit them from `managedFiles`.
- [ ] 5.4 Add tests `generator/tests/adopt.test.ts` (or extend): intact → canonical hash, customized → canonical not local, strategy preserved, unmaterializable baseline errors without manifest, repeat adopt deterministic.

## 6. O5 – Post-validations and rollback

- [ ] 6.1 Implement `runPostValidations(projectDir, extraIds)` allow-list runner (`typecheck`, `lint`, `test`, `manifest`, `generator-smoke`) mapping to commands, skipping absent scripts as `not-applicable`, timeout 30s, capturing stdout/stderr and failed id.
- [ ] 6.2 Integrate runner into `update-project.ts` apply path unioned with registry `postValidations`; dry-run skips all validations; failure triggers file+manifest rollback and non-zero exit.
- [ ] 6.3 Add tests `generator/tests/post-validations.test.ts` & E2E rollback: typecheck fails→rollback, lint fails→rollback, test fails→rollback, all pass→manifest bump, registry-declared validation runs, dry-run does not spawn validations, manifest unchanged on validation failure.

## 7. O7/O8 – Version dedup and migration honesty + docs

- [ ] 7.1 Derive `STARTER_VERSION` from `getCanonicalStarterVersion()` (or assert equality at import); add `generator/tests/version-sync.test.ts` guarding `package.json` vs `STARTER_VERSION` vs `createManifest` version vs docs fixtures.
- [ ] 7.2 Classify DB migration collision/tenancy changes as `manual-migration` in `update-plan.ts`; never auto-execute `db:migrate`; document block and manual instructions.
- [ ] 7.3 Rewrite `docs/updating-generated-projects.md`: state real `--to` source, list actually merged structured files, enumerate exact validations, add Limitations section, remove false claims (sequential engine, journal auto-patch, generic structured merge).
- [ ] 7.4 Sync `package.json`, `STARTER_VERSION`, Docker/README/changelog references; ensure `rg -n '0\.10\.1|STARTER_VERSION|getStarterVersion'` shows single source after change.

## 8. E2E and verification report

- [ ] 8.1 Implement `generator/tests/e2e-update.test.ts` full cycle in temp dir: prior-version fixture → adopt/load manifest → personalize (script, dep, `.env.example` var, managed conflict, unmanaged domain file) → `doctor` → `diff` (assert safe/conflict/canonical) → resolve conflict → `update --apply` (verify merges, `appliedUpdates`, hashes, validations, backup) → repeat for idempotence → force validation failure → assert rollback; plus edge matrix (`.env` untouched, upstream-removed-but-customized, upstream-new-but-local-different, copy-fail rollback, subdirectory paths, stable JSON).
- [ ] 8.2 Populate `docs/verification-generated-project-update-vnext.md` rows O1–O8 with final State (`CONFIRMED`/`REJECTED`/etc), evidence (call-flow lines, command outputs, hashes), and action taken or reason to not change.
- [ ] 8.3 Ensure no generated project gains a runtime dependency on `api-starter`; grep guard `rg -n 'api-starter' apps/api/src packages modules --glob '!**/manifest*'` remains clean.

## 9. Final validation and delivery

- [ ] 9.1 Run `bun run generator:validate`, `bun run lint`, `bun run typecheck` clean.
- [ ] 9.2 Run `bun test --coverage` (and `DATABASE_URL=... bun test --parallel=1` if PG available, otherwise record skipped) and ensure no new failures vs baseline.
- [ ] 9.3 Manual smoke in temp root: `create:project --profile minimal → doctor → diff → update dry-run → update --apply → repeat diff/update` demonstrates idempotence and correct `manifest.starter.version`.
- [ ] 9.4 Verify `git diff --check`, `git status --short`, and that dry-run/tests never mutate `bun.lock` or consumer lockfiles.

```

## docs/openspec/changes/fix-generated-project-update-safety/specs/architecture-guardrails/spec.md

- Source: docs/openspec/changes/fix-generated-project-update-safety/specs/architecture-guardrails/spec.md
- Lines: 1-9
- SHA256: f3ea893ceb2fd0466def8db574ee2f6399c41b2a5de1f3958275dabd3e67a659

```md
## ADDED Requirements

### Requirement: Factory invariant preserved

Generated projects SHALL NOT acquire a runtime dependency on `api-starter` as a result of the update machinery. The updater remains generator tooling (`generator/src/*`) and SHALL NOT introduce an IoC container, config DSL, dynamic plugin runtime, or mandatory `api-starter` import into `apps/api`/`packages`/`modules`.

#### Scenario: Generated project remains standalone
- **WHEN** a project is inspected after `update --apply`
- **THEN** its `package.json` dependencies contain no `api-starter` runtime import and it boots without the starter checkout present

```

## docs/openspec/changes/fix-generated-project-update-safety/specs/generator-adopt/spec.md

- Source: docs/openspec/changes/fix-generated-project-update-safety/specs/generator-adopt/spec.md
- Lines: 1-37
- SHA256: f482f49842e63ab615766ca7e3b1fd2f6b3385e541b8b4eba49ebdcac7a1b1b7

```md
## ADDED Requirements

### Requirement: Adopt stores canonical baselineHash with real strategy

For each file that exists in the materialized baseline of the declared `--baseline` version, `generator:adopt` SHALL set `manifest.managedFiles[rel].baselineHash` to `hashFileContent(baselineContent)` (canonical), SHALL set `strategy` to `getFileStrategy(rel)` (not always `managed`), and SHALL report divergence as `customized` vs `intact` without persisting the local hash as if it were canonical. The manifest SHALL NOT contain a `currentHash` field unless the schema explicitly supports it.

#### Scenario: Customized file retains canonical hash
- **WHEN** baseline contains `apps/api/src/app.ts` with hash `sha256:aaa` but local file has `sha256:bbb`
- **THEN** adopt writes `baselineHash: sha256:aaa` for that path, reports `customized: apps/api/src/app.ts`, and future `diff` correctly classifies upstream change as `conflict`

#### Scenario: Intact file stores canonical hash
- **WHEN** local file equals baseline content
- **THEN** adopt writes `baselineHash` equal to that canonical hash and reports no divergence for that file

#### Scenario: Strategy reflects file type
- **WHEN** adopt processes `package.json`
- **THEN** its entry has `strategy: "structured"` not `managed`

### Requirement: Adopt validates baseline materializability

`generator:adopt` SHALL accept only a `--baseline` version that can be materialized from the current checkout (either the verified canonical version or a snapshot/fixture that truly represents that historical tag). If the requested baseline cannot be materialized, it SHALL fail with a clear error, SHALL NOT create `.api-starter/manifest.json`, and SHALL NOT claim the result represents a historical version it did not materialize.

#### Scenario: Unmaterializable baseline is rejected
- **WHEN** `generator:adopt -- --project=/tmp/legacy --baseline=0.10.1` runs but `materializeToTemp` only produces the `0.11.0` checkout
- **THEN** adopt exits non-zero stating baseline `0.10.1` is not materializable from current checkout and no manifest is written (or caller must provide fixtures/snapshot to support it)

#### Scenario: Adopt supports only canonical version when no snapshot
- **WHEN** only canonical `0.11.0` is materializable and `--baseline=0.11.0` is given
- **THEN** adopt succeeds using that canonical tree; any other `--baseline` is rejected per above

### Requirement: Adopt handles missing expected files deterministically

If a file expected from the baseline is absent locally, `generator:adopt` SHALL report it as `missing: <rel>` and omit it from `managedFiles` (or explicitly handle per documented policy), so a future `update` does not silently add it back without surfacing intent.

#### Scenario: Missing expected file reported
- **WHEN** baseline has `apps/api/src/generated/foo.ts` but project deleted it
- **THEN** adopt reports `missing: apps/api/src/generated/foo.ts` and future `diff` shows `add` vs `conflict` per classification table without silently re-adding

```

## docs/openspec/changes/fix-generated-project-update-safety/specs/generator-diff/spec.md

- Source: docs/openspec/changes/fix-generated-project-update-safety/specs/generator-diff/spec.md
- Lines: 1-37
- SHA256: e685b7df0e48f15a6514c637d4cedd6d507c7a8a5767b663d160f17ab2fd80cd

```md
## ADDED Requirements

### Requirement: Diff validates and reports canonical version truth

`generator:diff` SHALL resolve the starter's canonical version from the starter repository root (not the consumer project's `process.cwd()`), SHALL require `--to` to either be omitted (defaulting to canonical) or to exactly match the canonical version, and SHALL reject with a clear non-zero error before any materialization if `--to` is missing-and-required, malformed, or mismatched. The JSON output `toVersion`, human header, and `UpdatePlan.toVersion` SHALL all equal the verified canonical version, never the raw user string when it diverges.

#### Scenario: Diff with mismatched --to is rejected read-only
- **WHEN** `bun run generator:diff -- --project=/tmp/proj --to=99.0.0 --json` runs while canonical is `0.11.0`
- **THEN** the command exits non-zero, emits `{ valid:false, error:"version mismatch: --to 99.0.0 != canonical 0.11.0" }` (or equivalent), and no file under `--project` is modified

#### Scenario: Diff without --to defaults to canonical
- **WHEN** `bun run generator:diff -- --project=/tmp/proj --json` runs (or with `--to 0.11.0` matching canonical)
- **THEN** output reports `toVersion: "0.11.0"` equal to the starter's `package.json` version and classification proceeds

#### Scenario: Diff JSON and human header agree on canonical version
- **WHEN** diff succeeds for a project at `0.10.1`
- **THEN** JSON `toVersion`, human `diff: ... (0.10.1 → 0.11.0)` line, and `buildUpdatePlan().toVersion` all equal the canonical package version

### Requirement: Diff surfaces registry path in dry-run

When `resolveUpdatePath(fromVersion, canonicalVersion)` yields steps, `generator:diff` SHALL include in its dry-run output the ordered `updatePath` IDs, `breakingNotes`, `requiresManual`, and `postValidations` declared by the registry, and SHALL mark the run invalid if the path is incomplete, a downgrade is requested, or no path exists for the requested jump.

#### Scenario: Missing update path is reported in diff
- **WHEN** a project at `0.10.1` diffs to `0.11.0` but registry lacks that edge
- **THEN** diff exits non-zero with message indicating incomplete path and does not claim the update is safe

#### Scenario: Diff shows breaking notes and manual requirements
- **WHEN** registry entry for `0.10.1→0.11.0` declares `breakingNotes` and `requiresManual`
- **THEN** diff JSON/human output lists those fields so the user knows action is required before apply

### Requirement: Diff remains pure read-only

`generator:diff` SHALL NOT write to the project, manifest, lockfile, or create backups; dry-run is pure. Multiple consecutive diffs with identical inputs SHALL produce byte-identical JSON aside from timestamps if any.

#### Scenario: Consecutive diffs are idempotent
- **WHEN** diff is run twice with same `--project` and `--to`
- **THEN** file hashes under `--project` are unchanged and second JSON `files` array equals the first

```

## docs/openspec/changes/fix-generated-project-update-safety/specs/generator-manifest/spec.md

- Source: docs/openspec/changes/fix-generated-project-update-safety/specs/generator-manifest/spec.md
- Lines: 1-33
- SHA256: 990e149d8f1605e5b1831186d775bba0efd21fb7db43c5ffee36a48f26e7a99e

```md
## ADDED Requirements

### Requirement: Single source of truth for starter version

The executable starter version SHALL be read from the starter repository's `package.json` located via a robust root resolution (e.g., `fileURLToPath(new URL("../../", import.meta.url))` or git-root detection), not from `process.cwd()` which may point to a generated consumer project. `STARTER_VERSION` constants, `createManifest` fallbacks, and docs SHALL be derived from that single source. If the version cannot be determined, the tool SHALL fail explicitly rather than silently falling back to a historical version like `0.10.1`.

#### Scenario: Consumer cwd does not pollute starter version
- **WHEN** `bun run generator:diff -- --project=/tmp/proj --to=0.11.0` is invoked from `/tmp/proj` (consumer)
- **THEN** resolved canonical version still equals the starter repo's `package.json` version (`0.11.0`), not any `package.json` in `/tmp/proj`

#### Scenario: Missing version fails loudly
- **WHEN** starter `package.json` has no `version` field
- **THEN** `getStarterVersion()` / `createManifest()` throws with message indicating version cannot be determined, rather than returning `0.0.0` or `0.10.1`

#### Scenario: Duplicate constants are anchored
- **WHEN** `STARTER_VERSION` constant exists
- **THEN** a validation (unit test or sync script) asserts `STARTER_VERSION === package.json version` and `createManifest` default matches it; divergence fails CI

### Requirement: No silent fallback to stale version

`createManifest` SHALL NOT silently use `0.10.1` when the real version is unavailable. The fallback SHALL be removed or guarded so that a non-derivable version surfaces as an error at generation/adopt/update time.

#### Scenario: Fallback removed
- **WHEN** `package.json` is temporarily unreadable
- **THEN** `createManifest` throws rather than emitting a manifest stamped `0.10.1`

### Requirement: Atomic write and stable ordering retained

Manifest writes SHALL remain atomic via temp file + rename with stable key/array ordering as before; this requirement is reaffirmed to survive refactors.

#### Scenario: Atomic write preserved
- **WHEN** `writeManifest` is invoked
- **THEN** no partial file is visible at `manifest.json` path and content is stable-sorted

```

## docs/openspec/changes/fix-generated-project-update-safety/specs/generator-update/spec.md

- Source: docs/openspec/changes/fix-generated-project-update-safety/specs/generator-update/spec.md
- Lines: 1-73
- SHA256: 11f4c02b8e8cc4b83c94af0728c59e48c3d2ecebc93d999310f3b92e9e22a614

```md
## ADDED Requirements

### Requirement: Update binds --to to canonical version before any write

`generator:update` SHALL reuse the same canonical-version resolution as `diff`, SHALL reject a mismatched `--to` before materializing or backing up, and SHALL record the manifest's new `starter.version` and `appliedUpdates` only from the verified canonical version. A fictitious version supplied via `--to` SHALL never be persisted.

#### Scenario: Update with fictitious --to is rejected without writes
- **WHEN** `bun run generator:update -- --project=/tmp/proj --to=99.0.0 --apply --json` runs with canonical `0.11.0`
- **THEN** the command exits non-zero before creating backups or mutating files, and manifest `starter.version` remains `0.10.1`

#### Scenario: Update records canonical version on success
- **WHEN** update `--to=0.11.0` (matching canonical) applies successfully
- **THEN** manifest `starter.version` is exactly `0.11.0` and JSON output `toVersion` equals `0.11.0`

### Requirement: Update integrates registry path atomically

`generator:update` SHALL compute `resolveUpdatePath(manifest.starter.version, canonicalVersion)`, SHALL reject if the path is empty yet `from !== to`, incomplete, or requires a downgrade, SHALL render each step's `id`, `from→to`, `breakingNotes`, `requiresManual`, and `postValidations` in dry-run, SHALL block `--apply` when any step declares `requiresManual` without an explicit safe confirmation, SHALL apply steps in registry order, SHALL append each completed `Update.id` once to `manifest.appliedUpdates` (no duplicates), and SHALL write the manifest only after all steps, file operations, and post-validations succeed.

#### Scenario: Multi-step update applies in order
- **WHEN** registry has `0.10.1→0.10.2` and `0.10.2→0.11.0` and project is at `0.10.1` updating to `0.11.0`
- **THEN** update executes steps in that order, and on failure in step 2 the first step's files are rolled back

#### Scenario: Downgrade is rejected
- **WHEN** manifest is `0.11.0` and user requests `--to=0.10.1 --apply`
- **THEN** update exits non-zero reporting downgrade not allowed and makes no writes

#### Scenario: Applied IDs are deduplicated
- **WHEN** an update `0.10.1→0.11.0` with id `0.10.1-to-0.11.0` is applied twice (second run idempotent)
- **THEN** `appliedUpdates` contains the id once after the first run and unchanged after the second

### Requirement: Structured files use explicit merge dispatch

For files with strategy `structured`, `generator:update` SHALL dispatch through `applyFileOperation` which: for `package.json` and `apps/api/package.json` invokes a conservative JSON merge that only touches managed keys (`dependencies`/`devDependencies` scoped to `@consulting/*`/`drizzle-*`), preserves consumer scripts/deps/metadata, and fails closed on JSON parse errors; for `.env.example` invokes `mergeEnvExample` key-wise preserving comments and local keys; for other `structured` paths without a safe parser SHALL classify as `conflict`/`manual-migration` rather than blindly copying canonical content. Successful merges SHALL hash the final written content for `baselineHash`.

#### Scenario: package.json merge preserves local fields
- **WHEN** project `package.json` has `scripts.my:script` and dep `lodash: 1.0.0`, upstream adds `@consulting/auth: 2.0.0`
- **THEN** after `update --apply`, `my:script` and `lodash` remain, `@consulting/auth` is added/updated, and project name/version unchanged

#### Scenario: Invalid JSON blocks update and triggers rollback
- **WHEN** project `package.json` is invalid JSON and an update-safe change exists
- **THEN** update exits non-zero, no file is left partially written, and rollback restores prior state

#### Scenario: Unsupported structured file becomes conflict
- **WHEN** a file classified `structured` has no registered safe merger
- **THEN** `diff`/`update` mark it `conflict` (or `manual-migration`) with reason, and `--apply` is blocked

### Requirement: Post-validations and rollback are deterministic

`generator:update --apply` SHALL run an allow-listed validation set (`typecheck` via `bun x tsc --noEmit`, `lint` via `bun run lint` when present, plus any `postValidations` ids declared by the registry that map to allow-listed commands), each with a bounded timeout, SHALL capture stdout/stderr and report which validation failed, SHALL roll back all file changes and restore the prior manifest on any validation failure, and SHALL NOT execute validations during dry-run. Unavailable validations SHALL be handled per policy `required|optional|not-applicable` and documented.

#### Scenario: Typecheck failure rolls back manifest and files
- **WHEN** an applied update introduces a type error
- **THEN** `runPostValidations` reports `typecheck failed`, files are restored from backups, manifest `starter.version` unchanged, exit non-zero

#### Scenario: Lint failure rolls back
- **WHEN** registry declares `postValidations: ["lint"]` and `bun run lint` fails
- **THEN** same rollback semantics as typecheck

#### Scenario: Dry-run does not execute validations
- **WHEN** `update -- --project=/tmp/proj --to=0.11.0` without `--apply`
- **THEN** no `bun x tsc` / `bun run lint` process is spawned

### Requirement: Update is atomic and idempotent

On any error after backup creation, `generator:update` SHALL restore modified/removed files from backups, delete newly added files, and restore the prior manifest, leaving a failure report. A second successful `update --apply` with same `from`/`to` SHALL perform zero writes and report no changes.

#### Scenario: Failure mid-copy rolls back first file
- **WHEN** safeOps contains two files and second copy throws
- **THEN** first file is restored from backup and manifest is not bumped

#### Scenario: Second run is idempotent
- **WHEN** update to `0.11.0` succeeded once
- **THEN** a repeat `update --apply --to=0.11.0` reports `no changes to apply`, makes no writes, and does not duplicate `appliedUpdates`

```

## docs/openspec/changes/fix-generated-project-update-safety/specs/generator-updates/spec.md

- Source: docs/openspec/changes/fix-generated-project-update-safety/specs/generator-updates/spec.md
- Lines: 1-49
- SHA256: 89e4ed4195c3f5252d701a8975cff8feaa6b44f6ca3ed319ae4061ef4c7a9553

```md
## ADDED Requirements

### Requirement: Registry path is authoritative for diff and update

Both `generator:diff` and `generator:update` SHALL call `resolveUpdatePath(fromVersion, canonicalVersion)` to obtain the ordered `Update[]` path, SHALL treat an empty path as valid only when `from === canonical`, SHALL reject incomplete paths, overshoots, and downgrades, and SHALL expose registry metadata (`id`, `breakingNotes`, `requiresManual`, `postValidations`, `reversible`) in dry-run output.

#### Scenario: from===to yields empty path and idempotence
- **WHEN** project at `0.11.0` diffs/updates to `0.11.0`
- **THEN** `resolveUpdatePath` returns `[]`, diff reports no changes valid=true, update --apply reports idempotent no-op

#### Scenario: Incomplete path rejected before writes
- **WHEN** project at `0.10.1` requests `0.11.0` but registry only has `0.10.1→0.10.2`
- **THEN** diff/update exit non-zero with `no update path from 0.10.2 to 0.11.0: missing ...`

#### Scenario: updatePath metadata surfaced
- **WHEN** registry entry declares `breakingNotes: "X"`
- **THEN** dry-run output includes that note for operator review

### Requirement: requiresManual blocks automatic apply

If any `Update` in the resolved path declares `requiresManual` non-empty, `generator:update --apply` SHALL be blocked until the manual condition has an explicit safe confirmation mechanism. The tool SHALL NOT add a global `--force` to bypass conflicts or manual steps.

#### Scenario: Manual step blocks apply
- **WHEN** path contains an update with `requiresManual: ["review tenancy migration"]`
- **THEN** `generator:update --apply` exits non-zero listing that manual requirement, without mutating files

### Requirement: Registry execution is ordered and recorded

When `--apply` is allowed, steps SHALL execute in registry order, SHALL run each step's `plan` callbacks if defined, SHALL roll back prior steps if a later step fails, and SHALL append each step's `id` to `manifest.appliedUpdates` exactly once and only after success.

#### Scenario: Order enforced
- **WHEN** fixtures register `0.10.1→0.10.2 (id A)` then `0.10.2→0.11.0 (id B)`
- **THEN** apply runs A before B

#### Scenario: Rollback spans multiple steps
- **WHEN** step B throws
- **THEN** files touched by A are restored and `appliedUpdates` does not contain A or B (atomic)

#### Scenario: Recorded IDs are registry IDs not generic strings
- **WHEN** update `0.10.1→0.11.0` succeeds with id `0.10.1-to-0.11.0`
- **THEN** `appliedUpdates` contains `0.10.1-to-0.11.0` not `0.10.1->0.11.0` generic arrow string

### Requirement: postValidations from registry extend base validations

Registry-declared `postValidations` SHALL be resolved against an allow-list (`manifest` check, `typecheck`, `lint`, `test`, `generator-smoke`) and executed as part of the update's validation phase with the same rollback semantics.

#### Scenario: Registry validation runs
- **WHEN** an update declares `postValidations: ["lint"]`
- **THEN** update --apply runs `lint` and failure triggers rollback as with typecheck

```

## docs/openspec/changes/fix-generated-project-update-safety/specs/generator-verification/spec.md

- Source: docs/openspec/changes/fix-generated-project-update-safety/specs/generator-verification/spec.md
- Lines: 1-29
- SHA256: e959045b03ae9ef43fa5b568c255d6d1b5962af7e6979091598c191a9b3b28e4

```md
## Purpose

Provides a reproducible audit report and E2E harness that proves generated-project update safety, preventing regressions of version-truth, merge-preservation, and rollback invariants.

## ADDED Requirements

### Requirement: Verification report matrix

The change SHALL deliver `docs/verification-generated-project-update-vnext.md` containing a row per observation O1–O8 with columns `ID | Observation | State | Evidence | Action`, where `State ∈ { CONFIRMED, PARTIALLY_CONFIRMED, REJECTED, ALREADY_FIXED }` and `Evidence` cites at least one of: call flow reference, reproducing test, CLI output, hash/file comparison, or passing test proof.

#### Scenario: Matrix completeness
- **WHEN** `docs/verification-generated-project-update-vnext.md` is inspected
- **THEN** it has rows O1 through O8 and no row lacks evidence or action text

### Requirement: E2E update cycle covered in temp harness

An integration suite SHALL exercise the full cycle in a temp directory (no real project mutation): fixture at prior version → adopt or load manifest → personalize `package.json` script, dep, `.env.example` key, managed conflict file, unmanaged domain file → `doctor` → `diff` → assert safe/conflict/canonical version → resolve conflict → `update --apply` → verify merges, hashes, `appliedUpdates`, validations, backup → repeat update for idempotence → force validation failure → confirm rollback.

#### Scenario: E2E harness passes
- **WHEN** `bun test generator/tests/e2e-update.test.ts` runs (or equivalent)
- **THEN** all steps above are asserted and temp dirs cleaned up

### Requirement: Negative and edge cases

The suite SHALL also cover `--to` fictitious, downgrade, missing path, two-step path, manual block, custom adopt hash, unmaterializable baseline, invalid structured JSON, `.env` untouched, upstream-removed-but-customized, upstream-new-but-local-exists-different, copy failure rollback, subdirectory paths, and stable `--json` output.

#### Scenario: Coverage of edges
- **WHEN** the negative-case tests run
- **THEN** each listed edge either fails with expected error or produces expected classification without silent overwrite

```

## docs/openspec/changes/fix-generated-project-update-safety/specs/starter-governance/spec.md

- Source: docs/openspec/changes/fix-generated-project-update-safety/specs/starter-governance/spec.md
- Lines: 1-9
- SHA256: 9dab36c19851e408b2d6f1fba0ce1f6dd4f48e64e01207b74da204ad85135e1a

```md
## ADDED Requirements

### Requirement: Version truth aligned across docs, Docker, and fixtures

Documentation, Docker examples, fixtures, and registry SHALL be synchronized after any version bump so that `docs/updating-generated-projects.md` describes only implemented behaviour, lists genuine limitations, and states the real `--to` source, the set of structured merges truly supported, and the exact validations executed.

#### Scenario: Docs reflect reality post-fix
- **WHEN** `docs/updating-generated-projects.md` is read after the change
- **THEN** it does NOT claim sequential registry execution unless it is implemented, does NOT claim generic structured merges beyond `package.json` / `.env.example`, lists `typecheck/lint/test` exactly as run, and has a Limitations section

```
