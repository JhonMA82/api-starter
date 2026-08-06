## ADDED Requirements

### Requirement: Update binds --to to canonical version before any write

`generator:update` SHALL reuse the same canonical-version resolution as `diff`, SHALL reject a mismatched `--to` before materializing or backing up, and SHALL record the manifest's new `starter.version` and `appliedUpdates` only from the verified canonical version. A fictitious version supplied via `--to` SHALL never be persisted.

#### Scenario: Update with fictitious --to is rejected without writes
- **WHEN** `bun run generator:update -- --project=/tmp/proj --to=99.0.0 --apply --json` runs with canonical `0.11.0`
- **THEN** the command exits non-zero before creating backups or mutating files, and manifest `starter.version` remains `0.10.1`

#### Scenario: Update records canonical version on success
- **WHEN** update `--to=0.11.0` (matching canonical) applies successfully
- **THEN** manifest `starter.version` is exactly `0.11.0` and JSON output `toVersion` equals `0.11.0`

### Requirement: Update integrates registry path atomically

`generator:update` SHALL compute `resolveUpdatePath(manifest.starter.version, canonicalVersion)`, SHALL reject if the path is empty yet `from !== to`, incomplete, or requires a downgrade, SHALL render each step's `id`, `from→to`, `breakingNotes`, `requiresManual`, and `postValidations` in dry-run, SHALL block `--apply` when any step declares `requiresManual` without an explicit safe confirmation, SHALL apply steps in registry order, SHALL append each completed `Update.id` once to `manifest.appliedUpdates` (no duplicates), and SHALL write the manifest only after all steps, file operations, and post-validations succeed.

#### Scenario: Multi-step update applies in order
- **WHEN** registry has `0.10.1→0.10.2` and `0.10.2→0.11.0` and project is at `0.10.1` updating to `0.11.0`
- **THEN** update executes steps in that order, and on failure in step 2 the first step's files are rolled back

#### Scenario: Downgrade is rejected
- **WHEN** manifest is `0.11.0` and user requests `--to=0.10.1 --apply`
- **THEN** update exits non-zero reporting downgrade not allowed and makes no writes

#### Scenario: Applied IDs are deduplicated
- **WHEN** an update `0.10.1→0.11.0` with id `0.10.1-to-0.11.0` is applied twice (second run idempotent)
- **THEN** `appliedUpdates` contains the id once after the first run and unchanged after the second

### Requirement: Structured files use explicit merge dispatch

For files with strategy `structured`, `generator:update` SHALL dispatch through `applyFileOperation` which: for `package.json` and `apps/api/package.json` invokes a conservative JSON merge that only touches managed keys (`dependencies`/`devDependencies` scoped to `@consulting/*`/`drizzle-*`), preserves consumer scripts/deps/metadata, and fails closed on JSON parse errors; for `.env.example` invokes `mergeEnvExample` key-wise preserving comments and local keys; for other `structured` paths without a safe parser SHALL classify as `conflict`/`manual-migration` rather than blindly copying canonical content. Successful merges SHALL hash the final written content for `baselineHash`.

#### Scenario: package.json merge preserves local fields
- **WHEN** project `package.json` has `scripts.my:script` and dep `lodash: 1.0.0`, upstream adds `@consulting/auth: 2.0.0`
- **THEN** after `update --apply`, `my:script` and `lodash` remain, `@consulting/auth` is added/updated, and project name/version unchanged

#### Scenario: Invalid JSON blocks update and triggers rollback
- **WHEN** project `package.json` is invalid JSON and an update-safe change exists
- **THEN** update exits non-zero, no file is left partially written, and rollback restores prior state

#### Scenario: Unsupported structured file becomes conflict
- **WHEN** a file classified `structured` has no registered safe merger
- **THEN** `diff`/`update` mark it `conflict` (or `manual-migration`) with reason, and `--apply` is blocked

### Requirement: Post-validations and rollback are deterministic

`generator:update --apply` SHALL run an allow-listed validation set (`typecheck` via `bun x tsc --noEmit`, `lint` via `bun run lint` when present, plus any `postValidations` ids declared by the registry that map to allow-listed commands), each with a bounded timeout, SHALL capture stdout/stderr and report which validation failed, SHALL roll back all file changes and restore the prior manifest on any validation failure, and SHALL NOT execute validations during dry-run. Unavailable validations SHALL be handled per policy `required|optional|not-applicable` and documented.

#### Scenario: Typecheck failure rolls back manifest and files
- **WHEN** an applied update introduces a type error
- **THEN** `runPostValidations` reports `typecheck failed`, files are restored from backups, manifest `starter.version` unchanged, exit non-zero

#### Scenario: Lint failure rolls back
- **WHEN** registry declares `postValidations: ["lint"]` and `bun run lint` fails
- **THEN** same rollback semantics as typecheck

#### Scenario: Dry-run does not execute validations
- **WHEN** `update -- --project=/tmp/proj --to=0.11.0` without `--apply`
- **THEN** no `bun x tsc` / `bun run lint` process is spawned

### Requirement: Update is atomic and idempotent

On any error after backup creation, `generator:update` SHALL restore modified/removed files from backups, delete newly added files, and restore the prior manifest, leaving a failure report. A second successful `update --apply` with same `from`/`to` SHALL perform zero writes and report no changes.

#### Scenario: Failure mid-copy rolls back first file
- **WHEN** safeOps contains two files and second copy throws
- **THEN** first file is restored from backup and manifest is not bumped

#### Scenario: Second run is idempotent
- **WHEN** update to `0.11.0` succeeded once
- **THEN** a repeat `update --apply --to=0.11.0` reports `no changes to apply`, makes no writes, and does not duplicate `appliedUpdates`
