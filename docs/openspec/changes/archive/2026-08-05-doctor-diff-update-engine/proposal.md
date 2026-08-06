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
