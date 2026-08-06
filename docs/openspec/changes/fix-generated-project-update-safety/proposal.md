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
