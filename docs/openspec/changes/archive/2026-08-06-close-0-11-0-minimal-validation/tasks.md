## 1. Baseline & Verification

- [x] 1.1 Verify A: inspect `.github/workflows/ci.yml` `migration-test`, `python yaml.safe_load` + `actionlint` if available, `gh run list` if auth; classify CONFIRMADA/PARCIAL/YA CORREGIDA/FALSO POSITIVO
- [x] 1.2 Verify B: run `bun test generator/tests/e2e-update.test.ts`, confirm tests call only `diff-project.ts`/`file-strategies` and idempotence is double no-op; inspect whether any test invokes `update-project.ts --apply --json` with real safe op
- [x] 1.3 Verify C: run `bun test generator/tests/post-validations.test.ts`, inspect `validate-post.ts` skip logic (`node_modules` gate) and `update-project.ts` backup/rollback/manifest-write order; classify gaps
- [x] 1.4 Capture baseline: `git status --short`, branch, `git log -1 --oneline`, `package.json` version, `.bun-version`, and initial `bun run generator:validate && bun run lint && bun x tsc --noEmit && bun test` outputs

## 2. Fix CI Workflow

- [x] 2.1 Correct `.github/workflows/ci.yml` indentation: change `       - run:` → `      - run:` on `migration-test` last step; validate YAML (`python -c yaml.safe_load`) and `actionlint` if available; ensure no job/struct/version/cache changes

## 3. E2E Real Update 0.10.1 → 0.11.0

- [x] 3.1 Create deterministic `0.10.1` fixture helper (reuse `generator/tests/helpers/tmp-project.ts:createTempProject` + manifest mutation to `0.10.1`, or version `generator/tests/fixtures/`) with valid manifest, profile/features, coherent hashes, at least one real safe `add`/`update-safe`/`remove-safe`, and unmanaged file support
- [x] 3.2 Add E2E test in `generator/tests/e2e-update.test.ts`: copy/build `0.10.1` fixture to temp, snapshot hashes, personalize `package.json` (script/dep), `.env.example` key, `.env` content, optional unmanaged domain file
- [x] 3.3 In same test: run `generator:diff --json` and assert `fromVersion==="0.10.1"`, `toVersion==="0.11.0"`, ≥1 real safe op, no spurious conflicts
- [x] 3.4 Run `generator:update --to 0.11.0 --apply --json`, assert exit 0, manifest `0.11.0`, `appliedUpdates` contains `0.10.1-to-0.11.0` once, upstream applied, `package.json` customization kept, `.env.example` key kept, `.env` byte-identical, unmanaged files kept, backup dir created
- [x] 3.5 In same test: snapshot post-apply hashes, re-run same `update --apply`, assert idempotence (exit 0, no file changes, no duplicate `appliedUpdates`, no unnecessary manifest bump)

## 4. Rollback on Failed Post-Validation

- [x] 4.1 Add test in `generator/tests/post-validations.test.ts` (or `e2e-rollback.test.ts`) that prepares updatable project with ≥1 safe op, provides deterministic `node_modules` so validations run, injects controlled failure (TS error / failing test / `exit 1` script), snapshots hashes/manifest/added|modified|removed state
- [x] 4.2 Run `generator:update --apply --json`, assert exit !=0, output indicates failed validation + rollback, all managed files restored, newly added files removed, deleted files restored, manifest byte-identical (version/`appliedUpdates` unchanged), local customizations preserved
- [x] 4.3 If `runPostValidations` contract hides `skipped` as `ok:true`, document evidence; only add `passed|skipped` distinction if mandatory for honest validation, keeping compat and adding unit tests

## 5. Full Verification & CI Green

- [x] 5.1 Run `bun install --frozen-lockfile && bun run generator:validate && bun run lint && bun run typecheck && bun test && bun test generator/tests/e2e-update.test.ts && bun test generator/tests/post-validations.test.ts && git diff --check && git status --short` (and `actionlint` if available, `DATABASE_URL=... bun test --parallel=1` if PG available)
- [x] 5.2 Push branch, open/update PR, ensure GitHub Actions shows green for `lint`, `typecheck`, `test`, `openapi-validation`, `docker-build`, `migrations-check`, `integration-test`, `migration-test`; on failure inspect log, fix only proven cause, re-run relevant suite

## 6. Closeout Documentation

- [x] 6.1 Create `docs/verification-0.11.0-minimal-closeout.md` with base commit, observation table + classification, pre-change evidence, modified files+rationale, added tests, executed commands+exit codes, green Actions link/id, out-of-scope findings, residual risks
