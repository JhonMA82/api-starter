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

