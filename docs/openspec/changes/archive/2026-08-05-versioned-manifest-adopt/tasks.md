## 1. Manifest infrastructure

- [x] 1.1 Implement `generator/src/hashing.ts`: SHA-256 `sha256:` hex, stable file hashing, helper for string hashing with tests
- [x] 1.2 Implement `generator/src/manifest.ts`: strict schema v1, interfaces, readManifest/writeManifest atomically, stable key ordering, validation for unknown features/future schema, no silent repair
- [x] 1.3 Implement `generator/src/materialize.ts`: pure materialization accepting ProjectPlan, shared by create-project and future diff/update; extract copy/prune/rewrite/template logic without duplication

## 2. Generation and add-feature integration

- [x] 2.1 Wire `generator/src/create-project.ts` to emit `.api-starter/manifest.json` after successful materialization (with baseline hashes) while keeping `GENERATED.md` as derived human view
- [x] 2.2 Update `generator/src/add-feature.ts` to read/update manifest atomically (features, hashes, updatedAt) and retain `GENERATED.md` sync; handle legacy fallback with deprecation warning
- [x] 2.3 Ensure managedFiles excludes secrets/.env/lockfile/build artifacts per spec §7.1

## 3. Adopt legacy projects

- [x] 3.1 Implement `generator/src/adopt-project.ts` for `generator:adopt` CLI: parse GENERATED.md, validate profile/features, compare vs baseline via materialize+hash, generate divergence report, write manifest only when verifiable, never guess baseline
- [x] 3.2 Add CLI arg handling for `--project` and `--baseline`, reporting categories intact/customized/missing before write
- [x] 3.3 Preserve legacy read path with deprecation warning for one version in manifest.ts/read helper

## 4. Tests and docs

- [x] 4.1 Tests: valid creation, stable serialization, future schema rejection, unknown feature rejection, hash stability, atomic write, add:feature manifest update, legacy read with warning, adopt with divergences
- [x] 4.2 Docs: update `docs/architecture.md` manifest section and README generation docs
- [x] 4.3 Baseline: `bun run lint/typecheck/test` and manifest generation for each profile to /tmp verifies hashes deterministic

