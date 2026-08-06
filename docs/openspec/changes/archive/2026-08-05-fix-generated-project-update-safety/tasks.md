## 1. Baseline and verification harness

- [x] 1.1 Record baseline `git status --short`, branch `fix-generated-project-update-safety` (or current feature branch with isolation), `git log -1 --oneline`, `cat package.json` version, `bun --version` in `docs/verification-generated-project-update-vnext.md` preamble.
- [x] 1.2 Run `bun run generator:validate`, `bun run lint`, `bun run typecheck`, `bun test` pre-change and log results; isolate pre-existing failures.
- [x] 1.3 Create `docs/verification-generated-project-update-vnext.md` skeleton with table `| ID | Observation | State | Evidence | Action |` for O1–O8 and fill after each O-investigation.
- [x] 1.4 Add temp-dir E2E helper `generator/tests/helpers/tmp-project.ts` (create minimal project, install manifest fixture, helpers for hash/file asserts) for isolated testing.

## 2. O1 – Canonical version truth

- [x] 2.1 Add `generator/src/starter-version.ts` (or extend `manifest.ts`) with `getCanonicalStarterVersion(): string` resolving starter root via `import.meta.url` + `git rev-parse` fallback, reading that `package.json` version, throwing on missing.
- [x] 2.2 Update `getStarterVersion()` and `createManifest()` to delegate to canonical helper; remove silent `0.10.1` fallback.
- [x] 2.3 Add `resolveTargetVersion(userTo: string | undefined): string` that defaults to canonical or validates equality, throwing `GenerationError` on mismatch before materialization.
- [x] 2.4 Wire `diff-project.ts` and `update-project.ts` to use `resolveTargetVersion`; make JSON `toVersion`, human header, `UpdatePlan.toVersion`, and manifest bump all use resolved canonical.
- [x] 2.5 Add unit tests `generator/tests/version-truth.test.ts`: omitted --to defaults to canonical, matching --to passes, mismatched --to fails read-only without writes, `diff` and `update` report same canonical.

## 3. O2 – Registry path integration

- [x] 3.1 Import `resolveUpdatePath` in `diff-project.ts`/`update-project.ts`; compute path after version resolve, include `updatePath` metadata in JSON and human dry-run.
- [x] 3.2 Block on incomplete path, overshoot, downgrade, and `requiresManual` non-empty (before any file write); emit clear error and non-zero exit.
- [x] 3.3 On `update --apply`, iterate `Update[]` in order, run optional `plan()` callbacks, collect per-step touched files for rollback, deduplicate `appliedUpdates` via Set, and write manifest only after all steps+validations succeed.
- [x] 3.4 Extend registry with test-only fixtures for two-step path (via mock `UPDATES` in tests) and verify ordering.
- [x] 3.5 Add tests `generator/tests/registry-integration.test.ts`: `from===to` empty idempotent, `0.10.1->0.11.0` resolves expected id, missing path rejected without writes, downgrade rejected, multi-step ordered, manual blocks, failure in step2 rolls back step1, ids recorded once.

## 4. O3 – Structured file dispatch

- [x] 4.1 Extend `file-strategies.ts` with `applyFileOperation()` dispatcher and make `mergePackageJson` throw on JSON parse error instead of returning `nextContent`.
- [x] 4.2 Update `update-plan.ts` to classify files with strategy `structured` but no safe merger as `conflict`/`manual-migration` with reason.
- [x] 4.3 Replace TODO copy-through in `update-project.ts` for `update-safe` with dispatcher; hash final written content for `baselineHash`; surface `strategy` and merge type in dry-run output.
- [x] 4.4 Add tests `generator/tests/file-strategies.test.ts` and `update-plan-structured.test.ts`: preserve local script/dep, add/update managed deps, remove retired managed dep, keep project name/metadata untouched, invalid JSON blocks + rollback, `.env.example` preserves local keys/comments/order/no duplicate on re-run, unsupported structured → conflict.

## 5. O4 – Adopt correctness

- [x] 5.1 Fix `adopt-project.ts` to store `baselineHash: hashFileContent(baselineContent)` and `strategy: getFileStrategy(rel)` for every baseline file; label `intact` vs `customized` via hash compare but keep canonical hash.
- [x] 5.2 Add `assertBaselineMaterializable(baseline: string)` guard (baseline must equal canonical or exist in fixtures snapshot map); fail without writing manifest if not materializable.
- [x] 5.3 Report missing expected files explicitly and omit them from `managedFiles`.
- [x] 5.4 Add tests `generator/tests/adopt.test.ts` (or extend): intact → canonical hash, customized → canonical not local, strategy preserved, unmaterializable baseline errors without manifest, repeat adopt deterministic.

## 6. O5 – Post-validations and rollback

- [x] 6.1 Implement `runPostValidations(projectDir, extraIds)` allow-list runner (`typecheck`, `lint`, `test`, `manifest`, `generator-smoke`) mapping to commands, skipping absent scripts as `not-applicable`, timeout 30s, capturing stdout/stderr and failed id.
- [x] 6.2 Integrate runner into `update-project.ts` apply path unioned with registry `postValidations`; dry-run skips all validations; failure triggers file+manifest rollback and non-zero exit.
- [x] 6.3 Add tests `generator/tests/post-validations.test.ts` & E2E rollback: typecheck fails→rollback, lint fails→rollback, test fails→rollback, all pass→manifest bump, registry-declared validation runs, dry-run does not spawn validations, manifest unchanged on validation failure.

## 7. O7/O8 – Version dedup and migration honesty + docs

- [x] 7.1 Derive `STARTER_VERSION` from `getCanonicalStarterVersion()` (or assert equality at import); add `generator/tests/version-sync.test.ts` guarding `package.json` vs `STARTER_VERSION` vs `createManifest` version vs docs fixtures.
- [x] 7.2 Classify DB migration collision/tenancy changes as `manual-migration` in `update-plan.ts`; never auto-execute `db:migrate`; document block and manual instructions.
- [x] 7.3 Rewrite `docs/updating-generated-projects.md`: state real `--to` source, list actually merged structured files, enumerate exact validations, add Limitations section, remove false claims (sequential engine, journal auto-patch, generic structured merge).
- [x] 7.4 Sync `package.json`, `STARTER_VERSION`, Docker/README/changelog references; ensure `rg -n '0\.10\.1|STARTER_VERSION|getStarterVersion'` shows single source after change.

## 8. E2E and verification report

- [x] 8.1 Implement `generator/tests/e2e-update.test.ts` full cycle in temp dir: prior-version fixture → adopt/load manifest → personalize (script, dep, `.env.example` var, managed conflict, unmanaged domain file) → `doctor` → `diff` (assert safe/conflict/canonical) → resolve conflict → `update --apply` (verify merges, `appliedUpdates`, hashes, validations, backup) → repeat for idempotence → force validation failure → assert rollback; plus edge matrix (`.env` untouched, upstream-removed-but-customized, upstream-new-but-local-different, copy-fail rollback, subdirectory paths, stable JSON).
- [x] 8.2 Populate `docs/verification-generated-project-update-vnext.md` rows O1–O8 with final State (`CONFIRMED`/`REJECTED`/etc), evidence (call-flow lines, command outputs, hashes), and action taken or reason to not change.
- [x] 8.3 Ensure no generated project gains a runtime dependency on `api-starter`; grep guard `rg -n 'api-starter' apps/api/src packages modules --glob '!**/manifest*'` remains clean.

## 9. Final validation and delivery

- [x] 9.1 Run `bun run generator:validate`, `bun run lint`, `bun run typecheck` clean.
- [x] 9.2 Run `bun test --coverage` (and `DATABASE_URL=... bun test --parallel=1` if PG available, otherwise record skipped) and ensure no new failures vs baseline.
- [x] 9.3 Manual smoke in temp root: `create:project --profile minimal → doctor → diff → update dry-run → update --apply → repeat diff/update` demonstrates idempotence and correct `manifest.starter.version`.
- [x] 9.4 Verify `git diff --check`, `git status --short`, and that dry-run/tests never mutate `bun.lock` or consumer lockfiles.
