## Why

`GENERATED.md` is human-readable and currently parsed as the machine source of truth, which is fragile for automation. To support safe, deterministic updates (doctor/diff/update) and idempotent re-generation, projects need a machine-readable, versioned manifest with stable hashes, file strategies, and applied-updates history. Existing projects with only `GENERATED.md` need an explicit adoption path that validates and hashes before writing.

## What Changes

- Introduce `.api-starter/manifest.json` as the canonical manifest with stable ordered keys:
  `schemaVersion` (current 1), `starter` { name, version, sourceRevision? }, `generation` { profile, features[], createdAt, updatedAt }, `managedFiles` { "<relative>": { baselineHash: "sha256:...", strategy: "managed"|"structured"|"scaffold"|"generated-region"|"ignored" } }, `appliedUpdates` []
  plus support for future migration tracking fields.
- Implement `generator/src/manifest.ts` with strict schema validation, actionable errors, atomic temp→rename writes, stable key ordering, unknown-feature and future-schema rejection, and no silent repair.
- Implement `generator/src/hashing.ts` (SHA-256 stable, hex, `sha256:` prefix) and `generator/src/materialize.ts` thin wrapper that materializes a `ProjectPlan` to a target dir without mutating caller.
- Generate new projects with both `.api-starter/manifest.json` (machine) and `GENERATED.md` (human derived view). `add:feature` migrates to update the manifest atomically as well as `GENERATED.md`.
- Keep legacy `GENERATED.md` read path for at least one version with a deprecation warning; do not parse it indefinitely as system source.
- Add `bun run generator:adopt -- --project=../legacy-api --baseline=0.1.0` that reads legacy marker only as migration input, validates profile/features against catalog, compares known files vs. baseline, reports divergences as customized/conflicting, and creates the manifest only when state is sufficiently verifiable. No guessing of baseline version.
- Exclude secrets, `.env`, DBs, build artifacts, and foreign lockfiles from managedFiles; record only starter-owned paths.

## Capabilities

### New Capabilities
- `generator-manifest`: versioned manifest creation, atomic persistence, validation, and hashing contract.
- `generator-adopt`: legacy adoption workflow that migrates `GENERATED.md` projects to the manifest with verifiable hashing and divergence reporting.

### Modified Capabilities
<!-- None - new behavior, not modification of existing specs -->

## Impact

- Affects: `generator/src/manifest.ts`, `generator/src/hashing.ts`, `generator/src/materialize.ts`, `generator/src/adopt-project.ts`, `generator/src/create-project.ts` (manifest emission), `generator/src/add-feature.ts` (manifest update), `generator/profiles.json` ordering guarantees, `package.json` scripts, `docs/architecture.md`.
- CLI: new `generator:adopt` script; existing `create:project` and `add:feature` behavior extended.
- No runtime `apps/api` changes beyond ensuring `.api-starter/` is gitignored-agnostic and not shipped as package dependency.
