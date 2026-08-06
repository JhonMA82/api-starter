---
comet_change: versioned-manifest-adopt
role: technical-design
canonical_spec: openspec
archived-with: 2026-08-05-versioned-manifest-adopt
status: final
---

# Technical Design: Versioned Manifest and Adopt

## Context

See `docs/openspec/changes/versioned-manifest-adopt/proposal.md` and `design.md`. Current `GENERATED.md` is parsed as source of truth; no `.api-starter/manifest.json`, no hashing, no atomic writer, no materialize abstraction. `add:feature` mutates directly.

Constraints: domain←application←http preserved; generator must not import Hono/Bun; atomic writes; deterministic ordering; no secret logging.

OpenSpec handoff: `docs/openspec/changes/versioned-manifest-adopt/.comet/handoff/design-context.md` (hash 4eeeb...), specs `generator-manifest` and `generator-adopt`.

## Goals / Non-Goals

**Goals:** Manifest schema 1, atomic persistence, SHA-256, materialize helper, adopt flow with divergence report, keep GENERATED.md as derived view, update add:feature.

**Non-Goals:** Doctor/diff/update classification (next change), migration registry, governance ADR.

## Technical Approach

### 1. Schema
`generator/src/manifest.ts` exports interfaces `Manifest { schemaVersion: 1, starter:{name,version,sourceRevision?}, generation:{profile,features,createdAt,updatedAt}, managedFiles: Record<string,{baselineHash,strategy}>, appliedUpdates: string[] }` with hand-rolled strict validator (no new deps), stable key ordering, actionable errors.

### 2. Hashing
`generator/src/hashing.ts` uses `node:crypto` `createHash('sha256')`, returns `sha256:<hex>`, stable by reading file as utf8 bytes and sorting manifest keys before stringify.

### 3. Materialize
`generator/src/materialize.ts` exposes `materializeToTemp(plan)` and `materializeProject(plan,outDir)` reusing `generateProjectFromPlan` copy/prune/rewrite/template logic but accepting a plan. Both `create:project` and future `diff/update` call it.

### 4. Strategies
Per file: `managed` (app.ts, routes.ts), `structured` (package.json, tsconfig.json, .env.example, drizzle.config.ts), `scaffold` (scripts/db). Computed via `file-strategies.ts` stub.

### 5. Adopt
Parse `GENERATED.md` regex `/profile:\s*(\S+)/` and `/features:\s*(.*)/`, validate via `validateFeatureSet`, materialize baseline to temp via `planFeatureSet`, hash-compare each managed file, build report categories intact/customized/missing. Only write manifest if verifiable. Atomic write via temp→rename. Legacy read path in `readManifestOrLegacy()` with deprecation warning to stderr.

### 6. Generation Integration
Wire `create:project` to emit `.api-starter/manifest.json` after successful materialization while keeping `GENERATED.md`. Update `add:feature` to patch manifest atomically.

## Data Flow

```
create:project → planFeatureSet/planFromSelection → generateProjectFromPlan → materializeToTemp (for hashing) → write .api-starter/manifest.json atomically → write GENERATED.md (derived)
add:feature → readManifestOrLegacy → planFeatureSet → materializeToTemp → update managedFiles hashes → write atomically
adopt → parse GENERATED.md → validate → materialize baseline → hash-compare → report → write manifest if verifiable
```

## Testing

- Valid creation, stable serialization, future schema rejection, unknown feature rejection, hash stability, atomic write, add:feature update, legacy read warning, adopt with divergences (intact vs customized).

## Risks

- Baseline for old version may be approximate → mark mismatches as customized not intact.
- Backup clutter → under `.api-starter/backups/` ignored.

## Migration

Additive; revert would delete manifest emission, legacy path still works.

## Open Questions

- None.
