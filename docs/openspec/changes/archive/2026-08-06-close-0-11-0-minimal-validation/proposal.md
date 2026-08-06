## Why

Version `0.11.0` has three pending minimal-validation gaps that block a green CI closeout: a potentially invalid `ci.yml` (extra indentation in `migration-test`), weak E2E coverage that never exercises a real `0.10.1 → 0.11.0 --apply` cycle through `update-project.ts`, and no automated proof that a post-validation failure triggers a full rollback. Closing them is required for a trustworthy 0.11.0 release without redesigning the generator engine.

## What Changes

- **Fix CI workflow YAML only if confirmed invalid**: correct indentation/syntax in `.github/workflows/ci.yml` `migration-test` steps (no job restructuring, no dependency upgrades).
- **Add authentic E2E `0.10.1 → 0.11.0`**: deterministic fixture/helper representing a `0.10.1` generated project (valid manifest, profile/features, coherent baseline hashes) with at least one real safe operation (`add`/`update-safe`/`remove-safe`) and a legitimate local customization (`package.json` script/dep, `.env.example` key, `.env` content, optional unmanaged domain file); test copies fixture to temp, validates `generator:diff` metadata (`fromVersion`, `toVersion`, safe ops, no spurious conflicts), runs `generator:update --apply`, asserts manifest bump to `0.11.0`, single `appliedUpdates` entry, upstream change applied, local customizations preserved, `.env` byte-identical, unmanaged files kept, backup created; then re-runs `update --apply` and asserts true idempotence (exit 0, no file changes, no duplicate `appliedUpdates`, no unnecessary manifest rewrite).
- **Add rollback-on-validation-failure proof**: integration/E2E test that prepares an updatable project with at least one safe op, provides deterministic deps so validations are not skipped, injects a controlled failure (unambiguous TS error or deliberately-failing test/script), snapshots hashes/manifest/file states, runs `update --apply`, and asserts non-zero exit, failure+rollback output, full restoration of managed files, removal of newly-added files, restoration of removed files, byte-identical manifest/version/`appliedUpdates`, and preserved local customizations.
- **Minimal production change only if a test reveals a mandatory defect**: otherwise changes stay in `.github/workflows/ci.yml` and `generator/tests/` plus strictly necessary fixtures/helpers.
- **Documentation**: add `docs/verification-0.11.0-minimal-closeout.md` with audit evidence.

## Capabilities

### New Capabilities

<!-- No new runtime capabilities — verification/CI hardening only -->

### Modified Capabilities

<!-- No spec-level behavior change; pure verification/CI fix. Using skip_specs: true -->

## Impact

- **Code**: `.github/workflows/ci.yml` (conditional), `generator/tests/e2e-update.test.ts`, `generator/tests/post-validations.test.ts`, new fixture/helper under `generator/tests/fixtures/` or helper, optionally minimal `generator/src/validate-post.ts` / `generator/src/update-project.ts` only if rollback/validation contract defect is proven, and `docs/verification-0.11.0-minimal-closeout.md`.
- **Systems**: GitHub Actions (8 jobs: lint, typecheck, test, openapi-validation, docker-build, migrations-check, integration-test, migration-test); Generator CLI (`diff-project.ts`, `update-project.ts`, `validate-post.ts`).
- **Dependencies**: No new runtime dependencies; YAML validation via existing tools/python `yaml` or `actionlint` if available — no permanent dependency added.
