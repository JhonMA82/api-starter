## ADDED Requirements

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
