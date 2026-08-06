---
comet_change: fix-generated-project-update-safety
role: technical-design
canonical_spec: openspec
archived-with: 2026-08-05-fix-generated-project-update-safety
status: final
---

# Deep Technical Design – fix-generated-project-update-safety

## Context and Scope

See `docs/openspec/changes/fix-generated-project-update-safety/proposal.md` (Why + What Changes) and `design.md` (high-level decisions D1–D8). This doc refines D1–D8 into implementable modules, file-level changes, and verification.

- Current engine: `generator/src/{diff-project,update-project,adopt-project,manifest,materialize,update-plan,file-strategies}` + `generator/updates/registry.ts` + `docs/updating-generated-projects.md`. Classification table exists; version binding, registry execution, structured merges, adopt hashing, validations are stubbed.
- Constraint: factory invariant – no `api-starter` runtime dep in `apps/api`, `packages/*`, `modules/*`; `apps/api/src/server.ts` only Bun entry.
- Delivery includes `docs/verification-generated-project-update-vnext.md` (O1–O8 matrix) and temp-dir E2E.

## Architecture Overview

```
CLI parse --project --to --apply --json
  -> getCanonicalStarterVersion()            // D1: starter root via import.meta.url, fallback git rev-parse
  -> resolveTargetVersion(userTo)            // D2: optional-and-must-match, throws before materialize
  -> readManifest(project) + validate
  -> resolveUpdatePath(from, canonical)      // D3: registry authority, surfaces metadata
  -> materializeToTemp(planFeatureSet(...)) // existing, unchanged – single canonical materialization
  -> buildUpdatePlan(...) + integrate registry requiresManual/postValidations/breakingNotes
  -> render dry-run (human + JSON with updatePath, strategy, mergeType)
  -> [if --apply] guards: conflicts, manual-migration, requiresManual -> block
  -> backup .api-starter/backups/<ts>/ + applyFileOperation dispatch // D4
  -> runPostValidations(allow-list + extras) // D6 – timeout, capture
  -> on success: recompute baselineHash from final content, dedup appliedUpdates, writeManifest atomically
  -> on failure: restore files + manifest, keep report, exit !=0
```

## Detailed Decisions

### D1 – Canonical version module `generator/src/starter-version.ts`

```ts
export function getStarterRoot(): string         // fileURLToPath(new URL("../../", import.meta.url)) + git fallback
export function getCanonicalStarterVersion(): string // reads <root>/package.json version or throws
export function assertCanonicalMatchesRegistry(): void
export function resolveTargetVersion(userTo?: string): string
```

- `STARTER_VERSION` in `registry.ts` becomes `getCanonicalStarterVersion()` (evaluated at import, cached) with test guard `STARTER_VERSION === pkg.version`.
- `manifest.ts:getStarterVersion()` and `createManifest()` delegate; fallback `"0.10.1"` removed.

### D2 – `--to` handling

- `diff-project.ts:parseArgs` makes `--to` optional. `main()` calls `resolveTargetVersion(to)` early, before `materializeToTemp`. JSON `toVersion` and header use resolved canonical.
- Error path: throw `GenerationError` → caught, printed as `{valid:false, error}` for `--json` or `error:` for human, exit 1 without side effects.

### D3 – Registry integration

- Both commands import `resolveUpdatePath`. After version resolve, `path = resolveUpdatePath(manifest.starter.version, canonical)`.
- `diff`: if thrown (incomplete/overshoot/downgrade), report `valid:false`.
- `update --apply`: if `path.some(u => (u.requiresManual?.length ?? 0) > 0)` → block. Also block if `buildUpdatePlan` has `manual-migration` ops.
- Apply loop: for each `Update` in order, if `update.plan` exists run it (collect PlannedOperations), merge with `buildUpdatePlan` safe ops, then apply. Track `touched: {path, backupPath, wasNew}[]`. On success append ids: `new Set([...manifest.appliedUpdates, ...path.map(u=>u.id)])`.
- Manifest write only after validations; single atomic call.

### D4 – Structured dispatch `file-strategies.ts`

```ts
export type ApplyOpts = { operation: FileOperation; projectPath: string; canonicalPath: string; canonicalDir: string }
export function applyFileOperation(opts: ApplyOpts): void // throws on unsupported/parse error
export function mergePackageJson(current: string, next: string, managedKeys?: Set<string>): string // throws on parse
```

- Map: `package.json`/`apps/api/package.json` → `mergePackageJson`; `.env.example` → `mergeEnvExample`; others with `structured` → throw `"unsupported structured file …"` → caller upgrades classification to `conflict`.
- `update-project.ts`: for `update-safe` with strategy `structured`, read both contents, call dispatcher, `writeFileSync(projectPath, merged)`. For `managed`/`scaffold` keep `copyFileSync`.
- Hash after write: `hashFileContent(readFileSync(projectPath,"utf8"))` stored.

### D5 – Adopt fix `adopt-project.ts`

```ts
function assertBaselineMaterializable(baseline: string): void // baseline === canonical || fixtureMap.has(baseline) else throw
```

- Loop: `baselineHash = hashFileContent(baselineContent)` even when `projectHash !== baselineHash`; `strategy = getFileStrategy(rel)`.
- Missing files: report, skip `managedFiles`.
- Write manifest only after loop succeeds.

### D6 – Validations `generator/src/validate-post.ts` (new or in `update-project.ts`)

- Allow-list:
  ```
  typecheck -> bun x tsc --noEmit
  lint      -> bun run lint   (skip if !pkg.scripts.lint)
  test      -> bun test --runInBand --bail --filter managed-tests  (skip if no test script)
  manifest  -> validateManifest(readManifestRaw)
  generator-smoke -> bun run generator:validate
  ```
- `runPostValidations(projectDir: string, extraIds: string[]): {ok, failedId?, output}`: union base + extra, sequential `execSync` with `timeout: 30000`, `stdio:"pipe"`, capture.

### D7 – Dedup and sync tests

- Remove fallback constant, add `generator/tests/version-sync.test.ts` asserting equality.

### D8 – Migration honesty

- In `update-plan.ts`, detect `rel.startsWith("migrations/")` or `_journal.json` changes with collision logic → classify `manual-migration`.

## Data Flow and Invariants

- **Version invariant:** `manifest.starter.version === canonical` post-success; `UpdatePlan.toVersion === canonical`.
- **Atomicity:** manifest written last; backups under `.api-starter/backups/<ISO>` (git-ignored via `.gitignore` check). Rollback restores `project/*` and manifest.
- **Idempotence:** second run `from===to` → `safeOps.length===0`, no writes, no duplicate `appliedUpdates`.
- **Dry-run purity:** no `mkdir/copy/writeManifest/exec` before `--apply`.
- **Determinism:** sort keys/paths, stable JSON, sorted `appliedUpdates` via Set preserve order.

## API / File Changes

- `generator/src/starter-version.ts` (new) + `manifest.ts` (delegate, remove fallback)
- `generator/src/file-strategies.ts` (add dispatcher, throw on parse)
- `generator/src/update-plan.ts` (manual-migration + unsupported structured → conflict)
- `generator/src/diff-project.ts` (version resolve, registry surface)
- `generator/src/update-project.ts` (version resolve, registry loop, dispatch, validations, dedup)
- `generator/src/adopt-project.ts` (hash/strategy fix, materializable guard)
- `generator/updates/registry.ts` (derive STARTER_VERSION from canonical)
- `generator/src/validate-post.ts` (new if split)
- `docs/updating-generated-projects.md` (honesty rewrite + Limitations)
- `docs/verification-generated-project-update-vnext.md` (new)
- `generator/tests/**` (7 suites)

## Testing Strategy

- **Unit –** `version-truth.test.ts`, `registry-integration.test.ts`, `file-strategies.test.ts`, `adopt.test.ts`, `post-validations.test.ts`, `version-sync.test.ts`, `update-plan-structured.test.ts` – temp dirs via `mkdtempSync`, hash assertions, no real project mutation, mock registry with two-step fixtures, spawn stubs for validations.
- **E2E –** `e2e-update.test.ts` exercises full lifecycle plus edge matrix: fictitious `--to`, downgrade, missing path, two-step ordered, manual block, custom adopt hash, unmaterializable baseline, invalid structured JSON, `.env` untouched, upstream-removed-but-customized, upstream-new-but-local-different, copy-fail rollback (injected error), subdirectory paths, stable `--json` (JSON.parse + deepEqual on sorted files). Backups hashed before/after to prove rollback.
- **Smoke –** manual `TMP_ROOT=$(mktemp -d); create:project minimal; doctor; diff; update dry-run; update --apply; repeat`.
- **Regression guard:** `bun run generator:validate` (no drift), `bun run lint` (biome ci), `bun x tsc --noEmit`, `bun test --coverage --threshold 0.8`.

## Risks and Mitigations

- Strict `--to` surfaces latent scripts errors → test phase adds migration hint.
- Adopt limitation to canonical is documented; future `generator/fixtures/snapshots/` can extend without API break.
- Structured narrowness prevents silent data loss; improvement is additive (add parser later).
- Validation slowness bounded by 30s and per-validation policy; skipped gracefully when script absent.

## Migration and Rollout

- Feature-branch (`fix-generated-project-update-safety`) with `--full` workflow; PR against `main` after verify pass.
- No DB/HTTP migration; tooling-only.
- `comet verify` gates archive: all 9 task groups must be checked; verify failures trigger repair loops (≤3 auto-fix, else decision).

## Open Questions Resolved

- Snapshot storage deferred; adopt doc notes it.
- `lint`/`test` treated as required when scripts exist per spec; remains tunable.
- Journal auto-patch explicitly out of scope; classified manual.
