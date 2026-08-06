## Context

See `proposal.md` — Why for motivation. Current generator state per branch `feature/20260806/granular-profiles-composition` at `f5aedf1`: CI `.github/workflows/ci.yml` `migration-test` has a stray leading space before `- run` causing `yaml.parser.ParserError`; `generator/tests/e2e-update.test.ts` exercises only `diff`/`fictitious --to`/no-op idempotence and unit `file-strategies` paths, never a real `0.10.1 → 0.11.0 --apply` through `update-project.ts` dispatcher; `generator/tests/post-validations.test.ts` asserts only happy paths via `runPostValidations` and never forces failure/rollback. `generator/src/update-project.ts` already implements backup + try/catch rollback + `validate-post` union (`runPostValidations(project, extraValidations)`) and `generator/src/validate-post.ts` skips heavy validations when `node_modules` absent. Canonical version is `0.11.0`, target legacy is `0.10.1` (must be added via fixture/helper without remote tags or network).

## Goals / Non-Goals

**Goals:**
- Prove YAML validity and 8-job green CI without restructuring jobs.
- Prove a deterministic real E2E `0.10.1 → 0.11.0 --apply` through the real dispatcher covering structured `package.json` merge, `.env.example` local-key preservation, `.env` immutability, unmanaged domain files, backup creation, and true idempotence (second `--apply` changes nothing).
- Prove post-validation failure after at least one safe operation restores everything (managed files, newly added files removed, removed files restored, manifest byte-identical, `appliedUpdates` unchanged, local customizations kept).
- Keep production diff minimal and auditable.

**Non-Goals:**
- No redesign of `doctor/diff/update/adopt`, manifest, profiles, catalog, authorization, or architecture.
- No job matrix, cache, version bumps, or Action upgrades.
- No new runtime dependencies.
- No mass refactor of `file-strategies` / hashing unless proven incompatible (then document instead of silently changing algorithm).

## Decisions

**D1 — CI fix: single-character indentation correction.**
- Choice: change `       - run:` (7 spaces) to `      - run:` (6 spaces) on the last line of `migration-test`.
- Rationale: minimal valid YAML; matches all other steps; `python -c yaml.safe_load` and optionally `actionlint` prove fix.
- Alternative: rewrite workflow or add yamllint dep — rejected (out of scope, adds dependency).

**D2 — E2E fixture strategy: build-from-helpers + small static fixture, not remote clone.**
- Choice: reuse `generator/tests/helpers/tmp-project.ts` `createTempProject({profile,features})` (which generates via `planFeatureSet`/`materializeToTemp` with correct manifest) then mutate its manifest to `0.10.1` and inject one deterministic upstream delta. If needed, version a fixture under `generator/tests/fixtures/` (e.g., `0.10.1-manifest.json` or full dir) and copy to temp. Deterministic hashing via `hashDir`/`hashFileContent`.
- Rationale: `createTempProject` already guarantees valid profile/features, coherent `managedFiles` hashes, `.api-starter/manifest.json`, and `.env` scaffolding; mutation to `0.10.1` is allowed because `resolveUpdatePath` validates path via `updates/registry` — we avoid network/tag clone and keep test offline.
- Upstream delta options (pick the safest that the current `buildUpdatePlan` classifies as safe):
  - Prefer an `add` (e.g., inject a new canonical file that `0.10.1` fixture lacks) — `add` never conflicts with local content.
  - Or `update-safe` where fixture is uncustomized (baseline hash equals old canonical) — dispatcher will treat as safe.
  - Avoid `conflict` by not personalizing the same path that upstream touches, unless testing structured merge explicitly. For structured merge coverage, use a `package.json` upstream dep addition versus a local `scripts.my:script` — current `structured` strategy (`file-strategies.ts`) merges both, so classification stays safe.
- Alternative: full checked-in fixture directory — heavier maintenance, but acceptable if helper alone cannot guarantee `fromVersion==="0.10.1"` and at least one safe op. Keep helper-first, fixture fallback.

**D3 — Structured merge E2E must hit dispatcher, not unit.**
- Choice: personalize `package.json` (`scripts`, `dependencies`) and `.env.example` before `diff`/`apply`; assert after `--apply` both upstream and local keys survive.
- Rationale: `update-project.ts:applyFileOperation` dispatches to `file-strategies.ts` when `strategy==="structured"`; direct unit call would not prove wiring.
- Conflict edge: if hashing classifies simultaneous structured change as `conflict`, document incompatibility and instead prove safe path (e.g., upstream touches `dependencies` while local touches `scripts`), per instruction.

**D4 — Post-validation rollback proof: deterministic `node_modules` presence + injected failure.**
- Choice: create temp project, inject `node_modules/.tmp` or minimal `package.json` + `scripts: { lint, test, typecheck }` and a dummy `node_modules` directory so `runPostValidations` does not skip; inject failure deterministically via one of: (a) corrupt a `.ts` file to fail `bun x tsc --noEmit`, (b) add a failing test file, (c) temporarily replace a validation script with `exit 1`. Save full snapshots (hashes, manifest JSON bytes, added/modified/removed lists) before `update --apply`; run `bun generator/src/update-project.ts --project <dir> --to 0.11.0 --apply --json` and assert exit !=0, output contains `post-validation`/`rolled back` markers, files restored, new files removed, deleted files restored, manifest byte-identical, version unchanged, `appliedUpdates` unchanged.
- Rationale: `validate-post.ts` skips heavy validations without `node_modules`; test must ensure they're executed to prove rollback path. The `try/catch` rollback in `update-project.ts` already iterates `backedUp` entries (`wasNew` → rm, else copy back) — test is a contract proof, not new rollback code.
- Contract note: if `runPostValidations` currently returns `{ok:true}` when skipping (hiding `skipped`), add evidence in closeout report; only change contract to `passed|skipped` distinction if mandatory for honest proof, keeping backward compatibility and adding unit tests.

**D5 — Verification vs modification gate.**
- Choice: audit each observation as CONFIRMED/PARTIAL/YA CORREGIDA/FALSO POSITIVO before editing; record file:line evidence.
- Rationale: satisfies `OPENCODE_CIERRE_MINIMO...` §Regla principal.

## Risks / Trade-offs

- [Generated canonical vs fixture canonical drift] → Pin fixture to `updates/registry` entries for `0.10.1 → 0.11.0`; if registry has no `0.10.1` path, treat `0.10.1` as synthetic `from` and ensure `diff`/`apply` still produce `fromVersion==="0.10.1"` by manifest mutation; update-plan derives canonical via `materializeToTemp(plan)` so upstream delta is measured against real `0.11.0` canonical.
- [Structured merge mis-classified as conflict] → Mitigate by separating keys (`scripts` vs `dependencies`) and by documenting instead of altering algorithm.
- [`node_modules` heavy setup slows tests] → Use lightweight marker dir + stub scripts rather than full `bun install`; scope timeout (30s per `validate-post.ts:TIMEOUT`).
- [Backup directory timestamp nondeterminism] → Assert existence, not exact name; use `hashDir` for content equality.
- [CI-only env for integration-test/migration-test] → Keep those tests isolated; local `bun test` should pass without DB, CI will run with `postgres:17-alpine`.

## Migration Plan

1. Fix `ci.yml` indentation; validate with `python -c yaml.safe_load` and `actionlint` if present.
2. Add E2E helper/fixture and new test case in `generator/tests/e2e-update.test.ts` (append, don't rewrite weak tests unless needed).
3. Add rollback test in `generator/tests/post-validations.test.ts` (or new `generator/tests/e2e-rollback.test.ts` if isolation needed).
4. If mandatory defect surfaces (e.g., validation contract hides `skipped`), patch `generator/src/validate-post.ts` minimally with compatibility, add unit test.
5. Run `bun install --frozen-lockfile && bun run generator:validate && bun run lint && bun run typecheck && bun test && bun test generator/tests/e2e-update.test.ts && bun test generator/tests/post-validations.test.ts && git diff --check`.
6. Push, open/update PR, verify GitHub Actions 8 jobs green; inspect logs on failure and fix only proven cause.
7. Produce `docs/verification-0.11.0-minimal-closeout.md`.

## Open Questions

- None that change scope; if structured-merge promise vs hash classification incompatibility appears, resolution is documented in the E2E test comment and closeout report rather than redesigning hashing outside scope.
