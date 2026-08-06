# generator-manifest Specification

## Purpose
Provides a stable, versioned machine-readable manifest that records starter version, feature set and baseline hashes so tooling can deterministically compare and update projects.
## Requirements
### Requirement: Manifest file is generated for new projects

For every newly materialized project, the generator SHALL write `.api-starter/manifest.json` with schemaVersion=1, starter { name:"@consulting/api-starter", version: "<exact package.json version>", sourceRevision?: git commit when available }, generation { profile: string, features: string[] sorted, createdAt/updatedAt ISO-8601 }, managedFiles { "<rel>": { baselineHash, strategy } }, appliedUpdates: []. The file SHALL have stable key and array ordering, and be written atomically via temp file + rename.

#### Scenario: New project contains valid manifest

- **WHEN** `bun run create:project -- --profile=minimal --out=/tmp/min` completes
- **THEN** `.api-starter/manifest.json` exists, validates against the strict schema, has baselineHash entries for each managed file matching SHA-256 of the generated content, and `GENERATED.md` still exists as a human view

#### Scenario: Manifest rejects future schema

- **WHEN** reading a manifest with `schemaVersion: 999`
- **THEN** the tool exits with an actionable error mentioning unsupported schema version and does not silently repair

### Requirement: Hash stability and strategy tagging

Every managed file entry SHALL include `baselineHash` as `sha256:<hex>` of the canonical generated content and `strategy` one of `managed`, `structured`, `scaffold`, `generated-region`, `ignored`. Secrets, `.env`, lockfiles foreign to starter, build artifacts and DB files SHALL NOT be recorded.

#### Scenario: Hash is stable across regenerations

- **WHEN** the same profile is materialized twice to two temp dirs
- **THEN** the SHA-256 hashes for each corresponding managed file are byte-identical

### Requirement: Strict validation and no silent repair

Reading the manifest SHALL validate: schemaVersion known, starter.version present, features all known and conflict-free, profile known, dates ISO-8601, managedFiles keys well-formed, and SHALL reject with actionable messages without attempting silent repair of corrupted JSON.

#### Scenario: Corrupt manifest rejected

- **WHEN** `generator:doctor` reads a truncated JSON manifest
- **THEN** it reports "manifest is corrupt" with the JSON parse error and does not overwrite the file

### Requirement: Add-feature updates manifest atomically

Running `add:feature` on a manifest-bearing project SHALL update `generation.features`, `managedFiles` hashes for affected files, and `generation.updatedAt`, writing atomically with stable ordering, only after successful materialization.

#### Scenario: Add feature bumps manifest

- **WHEN** `bun run add:feature -- --feature=tenancy --project=/tmp/proj` succeeds on a project generated with `authenticated`
- **THEN** the manifest's features array now includes `tenancy` sorted, its relevant managedFiles hashes updated, and the file was written via atomic rename (no partial write)

### Requirement: Single source of truth for starter version

The executable starter version SHALL be read from the starter repository's `package.json` located via a robust root resolution (e.g., `fileURLToPath(new URL("../../", import.meta.url))` or git-root detection), not from `process.cwd()` which may point to a generated consumer project. `STARTER_VERSION` constants, `createManifest` fallbacks, and docs SHALL be derived from that single source. If the version cannot be determined, the tool SHALL fail explicitly rather than silently falling back to a historical version like `0.10.1`.

#### Scenario: Consumer cwd does not pollute starter version
- **WHEN** `bun run generator:diff -- --project=/tmp/proj --to=0.11.0` is invoked from `/tmp/proj` (consumer)
- **THEN** resolved canonical version still equals the starter repo's `package.json` version (`0.11.0`), not any `package.json` in `/tmp/proj`

#### Scenario: Missing version fails loudly
- **WHEN** starter `package.json` has no `version` field
- **THEN** `getStarterVersion()` / `createManifest()` throws with message indicating version cannot be determined, rather than returning `0.0.0` or `0.10.1`

#### Scenario: Duplicate constants are anchored
- **WHEN** `STARTER_VERSION` constant exists
- **THEN** a validation (unit test or sync script) asserts `STARTER_VERSION === package.json version` and `createManifest` default matches it; divergence fails CI

### Requirement: No silent fallback to stale version

`createManifest` SHALL NOT silently use `0.10.1` when the real version is unavailable. The fallback SHALL be removed or guarded so that a non-derivable version surfaces as an error at generation/adopt/update time.

#### Scenario: Fallback removed
- **WHEN** `package.json` is temporarily unreadable
- **THEN** `createManifest` throws rather than emitting a manifest stamped `0.10.1`

### Requirement: Atomic write and stable ordering retained

Manifest writes SHALL remain atomic via temp file + rename with stable key/array ordering as before; this requirement is reaffirmed to survive refactors.

#### Scenario: Atomic write preserved
- **WHEN** `writeManifest` is invoked
- **THEN** no partial file is visible at `manifest.json` path and content is stable-sorted

