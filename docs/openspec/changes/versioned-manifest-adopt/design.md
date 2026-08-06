## Context

See proposal. Current repo uses `GENERATED.md` marker and `planProject`/`computeRemoveList`. No `.api-starter/manifest.json`, no hashing, no atomic manifest writer, no materialize abstraction. `add:feature` mutates project files directly and bumps `GENERATED.md` string.

Constraints: domain←application←http preserved; generator must not import Hono/Bun; atomic writes required; deterministic ordering; no secret logging.

## Goals / Non-Goals

**Goals:** Introduce manifest schema 1, atomic read/write, SHA-256 stability, materialize helper, adopt flow with divergence report, keep GENERATED.md as derived view, update add:feature to use manifest.

**Non-Goals:** Full doctor/diff/update classification (next change), migration registry, structured-file semantic merging beyond detection, governance docs.

## Decisions

### Decision 1: Schema layout
- **Choice:** `generator/src/manifest.ts` exports Zod-like strict validator (hand-rolled to avoid new dep) with interface `Manifest { schemaVersion: 1, starter:{name,version,sourceRevision?}, generation:{profile, features, createdAt, updatedAt}, managedFiles: Record<string,{baselineHash,strategy}>, appliedUpdates: string[] }`.
- **Rationale:** Simple JSON, no extra dependency, strict actionable errors.
- **Alternative:** Zod - rejected to keep `packages/*` zero deps.

### Decision 2: Hashing
- **Choice:** `generator/src/hashing.ts` uses `node:crypto` `createHash('sha256')`, returns `sha256:<hex>`, stable by reading file as utf8 bytes (for text) and sorting manifest keys before stringify.
- **Rationale:** Matches spec §7.1 SHA-256 stable, no FS timestamps.

### Decision 3: Materialize abstraction
- **Choice:** `generator/src/materialize.ts` exposes `materializeProject(plan: ProjectPlan, outDir: string)` that reuses `create-project.ts` copy/prune/write logic but accepts a plan rather than profileId. Both `create:project` and future `diff/update` call it.
- **Rationale:** Single materialization prevents drift; spec §10 explicitly says `create:project` and `generator:update` must share same materialization.
- **Alternative:** Duplicate logic - rejected.

### Decision 4: Manifest write strategies
- Strategy tags decided per file extension/path:
  - `managed`: most generated files (`apps/api/src/app.ts`, `routes.ts`, package rewrites result) - replace only if hash matches.
  - `structured`: `package.json`, `tsconfig.json`, `.env.example`, `drizzle.config.ts` - not replaced wholesale; handled by future file-strategies but tagged structured now.
  - `scaffold`: `scripts/db/*` where existence matters once - tagged scaffold, never auto-updated.
  - Computed at materialization time via `file-strategies.ts` stub.

### Decision 5: Adopt flow
- **Steps:** parse GENERATED.md regex `/profile:\s*(\S+)/` and `/features:\s*(.*)/`, validate via `validateFeatureSet`, materialize baseline version to temp dir using `planFeatureSet` (requires that baseline version's generator produce same file), hash-compare each managed file, build report categories: intact, customized-no-upstream, missing. Only write manifest if no unrecoverable error (missing GENERATED.md or unknown baseline). Divergent files recorded with current hash but note they are customized.
- **Atomicity:** `writeManifest(projectDir, manifest)` writes to `.api-starter/manifest.json.tmp` then `renameSync`.
- **Stable keys:** `JSON.stringify` with sorted keys helper.

### Decision 6: Legacy compat
- Keep reading GENERATED.md in `readManifestOrLegacy()` that first tries manifest, falls back to parsing GENERATED.md with warning to stderr. The warning mentions `bun run generator:adopt -- --project=<dir> --baseline=<version>`.

## Risks / Trade-offs

- **[Risk] Creating canonical baseline for old version may require checking out tag** → Mitigation: adopt docs say run from target starter checkout; implementation assumes current code can materialize approximate baseline (best-effort) and marks mismatches as customized rather than failing.
- **[Risk] .api-starter directory surprises .gitignore** → Mitigation: intentionally not gitignored; manifest is committed to allow drift detection. Add docs clarifying.

## Migration Plan

- Steps: create hashing.ts, manifest.ts, materialize.ts, adopt-project.ts, wire create-project to emit manifest, update add-feature to patch manifest, add tests, run `bun run lint/typecheck/test`.
- Rollback: delete `.api-starter/manifest.json` emission; legacy path still works.

## Open Questions

- None.
