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

## Open Questions

- Historical baseline snapshots: should `generator/updates/snapshots/` store zipped canonical trees for `adopt` to validate older `--baseline` values? Deferred to follow-up; current conservative block is acceptable.
- Whether `lint` and `test` should be `required` vs `optional` by default when scripts exist – proposal treats them as required when present; tunable later without spec change.
- Journal auto-patching design (O8 Route A) needs deeper spike – explicitly out of scope here, will revisit if tenancy migrations become frequent.
