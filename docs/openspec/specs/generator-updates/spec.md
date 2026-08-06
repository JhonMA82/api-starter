# generator-updates Specification

## Purpose
Ensures updates are applied in explicit sequential SemVer order with recorded history, feature applicability and no silent skips.
## Requirements
### Requirement: Sequential versioned updates

The updater SHALL resolve the path `from → to` as an ordered contiguous chain of registry entries (e.g., `0.10.1→0.10.2→0.11.0`). It SHALL reject incomplete paths, never skip a migration, record each successfully applied `id` in manifest `appliedUpdates`, and support idempotent re-run (already-applied entries produce no-ops). It SHALL use SemVer to distinguish patch/minor/major but MUST NOT mark an update as completed if its post-validations failed.

#### Scenario: Contiguous path succeeds

- **WHEN** a project at `0.10.1` updates `--to=0.10.3` where registry has `0.10.1→0.10.2` and `0.10.2→0.10.3`
- **THEN** both migrations run in order and `appliedUpdates` ends with both ids

#### Scenario: Gap in registry is rejected

- **WHEN** registry lacks `0.10.2→0.10.3` but user requests `0.10.1→0.10.3`
- **THEN** update exits non-zero reporting "no update path from 0.10.1 to 0.10.3: missing 0.10.2→0.10.3"

#### Scenario: Re-running applied update is idempotent and skips

- **WHEN** `generator:update -- --to=0.10.2 --apply` is run twice after first success
- **THEN** the second run reports no changes and does not duplicate entries in `appliedUpdates`

### Requirement: DB migration handling is non-destructive

The updater SHALL incorporate new migration files and journal patches deterministically, detect name/index collisions, generate a `manual-migration` entry for tenancy/data changes, never execute destructive DB migrations automatically, require explicit `bun run db:migrate`, and point to backup/rollback docs for potentially destructive changes.

#### Scenario: Duplicate journal name detected

- **WHEN** canonical journal contains a migration name already present locally with different content hash
- **THEN** doctor/diff report a collision error and update aborts before writing

#### Scenario: DB migration not auto-executed

- **WHEN** an update adds `migrations/00012_...sql`
- **THEN** `generator:update --apply` adds the file and patches `migrations/meta/_journal.json` but does not run `db:migrate`; docs state user must run it separately

