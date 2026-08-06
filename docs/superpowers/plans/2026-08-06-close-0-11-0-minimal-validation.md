---
change: close-0-11-0-minimal-validation
design-doc: docs/superpowers/specs/2026-08-06-close-0-11-0-minimal-validation-design.md
base-ref: f5aedf1889958df5d6f2e8625c9919f171d82278
archived-with: 2026-08-06-close-0-11-0-minimal-validation
---

# Plan: close-0-11-0-minimal-validation

## Context
Minimal closeout for 0.11.0 fixing CI YAML, adding authentic E2E 0.10.1→0.11.0 with dispatcher/idempotence, and rollback proof. Based on Design Doc `2026-08-06-close-0-11-0-minimal-validation-design.md` and tasks.md breakdown. Branch `feature/20260806/granular-profiles-composition`, base `f5aedf1`.

## Tasks

### 1. Baseline & Verification
- [x] Already done: verify A/B/C confirmed (YAML invalid, E2E weak, rollback missing). Capture baseline outputs.

### 2. CI Fix
- File: `.github/workflows/ci.yml`
- Step: correct line 122 indentation (7→6 spaces). Validate `yaml.safe_load` and report 8 jobs. No other changes.

### 3. Inspect Generator Internals for Safe Op Source
- Read `generator/updates/registry.ts`, `generator/src/starter-version.ts`, `generator/src/materialize.ts`, `generator/src/update-plan.ts`, `generator/tests/helpers/tmp-project.ts`.
- Determine file that will be classified `add` or `update-safe` for 0.10.1→0.11.0 (compare materialized 0.11.0 vs mutated 0.10.1 fixture). Ensure registry returns path id `0.10.1-to-0.11.0`.

### 4. E2E Real Update Test
- File: `generator/tests/e2e-update.test.ts`
- Add test `real 0.10.1 → 0.11.0 via dispatcher with preservation and true idempotence`
- Steps: createTempProject → mutate to 0.10.1 → personalize → diff assertions → apply → post-apply assertions (version, appliedUpdates, upstream applied, local preserved, .env identical, unmanaged kept, backup exists) → second apply idempotence.
- Include comments for conflict edge handling.

### 5. Rollback Test
- File: `generator/tests/post-validations.test.ts` or new `generator/tests/e2e-rollback.test.ts`
- Add test `post-validation failure rolls back fully after safe ops`
- Steps: build updatable 0.10.1 project → snapshot hashes/manifest → create node_modules stub → inject deterministic lint failure (`scripts.lint = "node -e 'process.exit(1)'"`) → run update --apply → assert rollback.

### 6. Production Contract Fix (only if proven)
- If `runPostValidations` hides skipped as ok:true, note in verification report; only patch if mandatory (add skippedIds, keep compat).

### 7. Verification & Closeout
- Run full suite, actionlint, db tests if PG, git diff --check, push, verify 8 CI jobs green, write `docs/verification-0.11.0-minimal-closeout.md`.

## Execution
- Isolation: current branch (already feature branch, dirty .agents/.opencode etc present — but change is minimal)
- Mode: executing-plans (simple, few files) or subagent-driven (3+ tasks). Recommend executing-plans with tdd direct, review standard (single final review).
