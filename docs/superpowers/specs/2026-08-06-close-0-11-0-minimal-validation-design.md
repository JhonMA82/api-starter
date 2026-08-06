---
comet_change: close-0-11-0-minimal-validation
role: technical-design
canonical_spec: openspec
archived-with: 2026-08-06-close-0-11-0-minimal-validation
status: final
---

# Design: close-0-11-0-minimal-validation

## Overview

Minimal closeout for `0.11.0`: fix invalid CI YAML, prove a real `0.10.1 → 0.11.0` update through `update-project.ts` dispatcher with preservation and idempotence, and prove rollback on post-validation failure. No engine redesign.

## Context

Branch `feature/20260806/granular-profiles-composition` at `f5aedf1`, `package.json` version `0.11.0`, Bun `1.3.14`. See `docs/openspec/changes/close-0-11-0-minimal-validation/proposal.md` (Why) and `design.md` (high-level decisions D1–D5). Existing `generator/src/update-project.ts` already does backup → applyFileOperation → `runPostValidations(project, extraValidations)` → manifest bump → rollback on catch. `validate-post.ts` skips heavy validations without `node_modules`. Gaps are purely verification: CI indent invalid, E2E never hits dispatcher with safe op, post-validation never fails.

## Detailed Design

### 1) CI Workflow Fix

- File: `.github/workflows/ci.yml:120-122`
- Change: `       - run: bun test modules/notes/tests/migrations.test.ts ...` → `      - run: bun test modules/notes/tests/migrations.test.ts ...` (7→6 spaces)
- Validation: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"` must exit 0 and report 8 jobs; `actionlint` if available; `gh run list` optional.
- Constraint: no other line/job/version/cache/matrix change.

### 2) E2E Real Update `0.10.1 → 0.11.0`

#### 2.1 Fixture construction (offline, deterministic)

- Helper: `generator/tests/helpers/tmp-project.ts` (`createTempProject`, `hashDir`, `writePersonalization`, `cleanup`)
- Steps to build a `0.10.1` project:
  1. `const {dir} = createTempProject({profile:"minimal",features:[]})` — produces valid manifest with canonical `0.11.0`.
  2. Mutate `.api-starter/manifest.json` `starter.version` to `"0.10.1"`; adjust `managedFiles` baseline hashes to be coherent (or version a fixture `generator/tests/fixtures/0.10.1/minimal-manifest.json` and copy). Also ensure `updates/registry` path exists for `0.10.1→0.11.0` (see §2.2).
  3. Ensure at least one real safe operation exists:
     - Preferred `add`: remove a canonical file from fixture (e.g., a new `0.11.0` file) so `buildUpdatePlan` classifies it `add`. Candidate files to inspect: `materializeToTemp` output for `0.11.0` minimal profile — diff against fixture; pick a small safe file (e.g., a new doc or lib file) — do not use `package.json` for `add`.
     - Fallback `update-safe`: leave a managed file uncustomized (baseline hash == `0.10.1` canonical hash) but ensure `0.11.0` canonical has different content, so plan is `update-safe`.
     - Structured merge: if safe `add` is missing, use `package.json` where local touches `scripts.my:script` / `dependencies.lodash` and upstream (canonical) adds a dep in different key; current `structured` strategy merges both keys → classification stays safe.
  4. Keep profile/features valid so `materializeToTemp` for `0.11.0` works.

#### 2.2 Registry path

- Source: `generator/updates/registry.ts` and `generator/src/starter-version.ts`. Canonical `0.11.0` is latest; `0.10.1` may not have an explicit entry — if missing, registry's `resolveUpdatePath("0.10.1","0.11.0")` must either return `[{id:"0.10.1-to-0.11.0",...}]` or throw. If it throws, add minimal synthetic entry or document that test treats `0.10.1` as synthetic `from` and still asserts `diff` shows `fromVersion==="0.10.1"` / `toVersion==="0.11.0"` via mutated manifest + `buildUpdatePlan` canonical diff (registry error path would block apply, so registry must expose the path). Inspect `updates/registry.ts` first; prefer adding entry if absent (minimal, no redesign).

#### 2.3 Test steps (single `test("real 0.10.1 → 0.11.0 dispatcher, preservation, and idempotence", ...)`)

1. Build `0.10.1` dir, save `hashDir(dir)` Map pre.
2. Personalize: `writePersonalization(dir,{packageJson:{scripts:{"my:script":"echo hello"},dependencies:{lodash:"1.0.0"}}})`; append `MY_LOCAL_KEY=keepme` to `.env.example`; `writeFileSync(.env,"MY_LOCAL_KEY=keepme\n")`; optionally `mkdir modules/... && write unmanaged file`.
3. Run `bun generator/src/diff-project.ts --project <dir> --to 0.11.0 --json` via `Bun.spawnSync`; parse; assert `fromVersion==="0.10.1"`, `toVersion==="0.11.0"`, `files.some(f=>["add","update-safe","remove-safe"].includes(f.classification))`, `conflicts.length===0`.
4. Snapshot `readFileSync(manifest.json,"utf8")`, `hashDir`, `.env` bytes.
5. Run `bun generator/src/update-project.ts --project <dir> --to 0.11.0 --apply --json`; assert `exitCode===0`.
6. Assert: `readManifest(dir).starter.version==="0.11.0"`, `appliedUpdates` contains `"0.10.1-to-0.11.0"` exactly once, upstream file content changed/added, `package.json` still has `my:script` & `lodash`, `.env.example` still has `MY_LOCAL_KEY`, `.env` byte-identical, unmanaged file exists, `existsSync(dir/.api-starter/backups)` true and contains backup for modified file.
7. Snapshot `hashDir` after first apply.
8. Re-run same `update --apply --json`; assert exit 0, `hashDir` unchanged, `appliedUpdates` identical, manifest file mtime/content not rewritten unnecessarily (optional: compare bytes pre/post second apply).

Note: must call dispatcher, not `file-strategies` directly; assertions use real CLI.

### 3) Rollback on Post-Validation Failure

#### 3.1 Setup to ensure validations run

- `validate-post.ts` gate: `hasNodeModules = existsSync(node_modules)`. Without it, `base` validations empty and `runPostValidations` returns `{ok:true}` even if broken. Test must create `dir/node_modules/.keep` (empty dir) and ensure `package.json` has `scripts:{lint:"biome ci .",test:"bun test",typecheck? implied}` so `base` includes `typecheck`,`lint`,`test`.
- Lightweight failure injection (pick one deterministic, fast):
  - **Typecheck**: inject a `.ts` file with `const x: string = 123 as unknown as string` is valid; need truly invalid: `syntax error` or `export const bad: string = (null as unknown as number)` without cast? Use `writeFileSync(path.join(dir,"apps/api/src/bad-type.ts"), "export const bad: string = 123;\n")` — `tsc --noEmit` will fail.
  - **Test**: write `writeFileSync(path.join(dir,"bad.test.ts"), "import {test,expect} from 'bun:test'; test('fail',()=>expect(1).toBe(2))")` and ensure `runPostValidations` runs `bun test --bail`.
  - **Lint**: replace `lint` script with `node -e 'process.exit(1)'` for deterministic fast failure — safest to avoid installing `biome`.
- Choose `lint` or `test` injection for speed and determinism; leave note that `typecheck` without `node_modules/.keep` would be skipped.

#### 3.2 Snapshots and execution

1. Build updatable `0.10.1` project as in §2.1 (need ≥1 safe op).
2. Snapshot: `hashDir`, `readFileSync(manifest.json,"utf8")`, `readFileSync(package.json,"utf8")`, record `existsSync` for each safe op target (add: not exists before, update: exists).
3. Write `node_modules/.keep` and inject failing script/file.
4. Run `bun generator/src/update-project.ts --project <dir> --to 0.11.0 --apply --json` via `Bun.spawnSync`; capture `stdout`/`stderr`.
5. Assert: `exitCode !== 0`, output contains `post-validation` / `typecheck failed` / `test failed` / `lint failed` and `rolled back`, `hashDir` equals pre snapshot, added files no longer exist, removed files restored, `readFileSync(manifest.json,"utf8")` byte-identical (version still `0.10.1`, `appliedUpdates` unchanged), local `my:script`/`MY_LOCAL_KEY` preserved, `.env` identical.
6. Cleanup: `cleanup(dir)`.

#### 3.3 Contract note

- If `runPostValidations` returns `{ok:true}` when all skipped, note in `docs/verification-0.11.0-minimal-closeout.md` §Evidence; do not silently change contract to `{ok,skipped}`. Only add `skippedIds` distinction if mandatory for honest output, keeping backward compat (`ok:true` still means no failure) and adding unit test for skipped case.

### 4) Edge Cases

- Registry missing `0.10.1` path → add entry or document synthetic-from.
- Structured merge classified `conflict` → document incompatibility and prove safe-key-separated path.
- `hasScript` missing → add minimal `scripts` to fixture.
- `TIMEOUT 30_000` → test timeout set >40s.
- Backup timestamp collision → assert existence, not equality.

## Testing Strategy

- Unit: existing `file-strategies` / `hashing` remain; add no new unit unless `validate-post` contract change requires it.
- Integration/E2E: new test in `generator/tests/e2e-update.test.ts` (real `0.10.1→0.11.0`); new test in `generator/tests/post-validations.test.ts` or `generator/tests/e2e-rollback.test.ts`.
- Local suite: `bun install --frozen-lockfile && bun run generator:validate && bun run lint && bun run typecheck && bun test && bun test generator/tests/e2e-update.test.ts && bun test generator/tests/post-validations.test.ts && git diff --check && python yaml.safe_load + actionlint; DB tests if `DATABASE_URL` available`.
- CI: 8 jobs green; inspect logs on failure.

## Risks

- Canonical drift between generated `0.11.0` and fixture → pin via `updates/registry` + `materializeToTemp(plan)`.
- Flaky `typecheck` due to missing `node_modules/@types/bun` → use lint/test injection instead of typecheck for determinism.
- `biome ci` without config fails differently locally vs CI → use stub `lint: "node -e 'process.exit(1)'"` only in rollback test for injection.
- Backup leftover after rollback keeps dir → not asserted as failure.

## Alternatives Considered

- **Full checked-in fixture dir**: heavier to maintain with every `0.11.0` change; helper mutation cheaper but fallback acceptable.
- **Direct `file-strategies` unit**: would not prove dispatcher wiring required by acceptance.
- **Remote clone of tag `0.10.1`**: violates offline determinism.

## Open Questions

None blocking; structured-merge vs hash edge documented in report if hit.

## Implementation Order

1. Fix `ci.yml` and validate.
2. Inspect `updates/registry.ts` + `materializeToTemp` to confirm safe op source for `0.10.1` fixture.
3. Add E2E `0.10.1→0.11.0` test.
4. Add rollback test.
5. Run full suite, push, verify CI, write closeout report.
