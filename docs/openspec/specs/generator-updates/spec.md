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

### Requirement: Registry path is authoritative for diff and update

Both `generator:diff` and `generator:update` SHALL call `resolveUpdatePath(fromVersion, canonicalVersion)` to obtain the ordered `Update[]` path, SHALL treat an empty path as valid only when `from === canonical`, SHALL reject incomplete paths, overshoots, and downgrades, and SHALL expose registry metadata (`id`, `breakingNotes`, `requiresManual`, `postValidations`, `reversible`) in dry-run output.

#### Scenario: from===to yields empty path and idempotence
- **WHEN** project at `0.11.0` diffs/updates to `0.11.0`
- **THEN** `resolveUpdatePath` returns `[]`, diff reports no changes valid=true, update --apply reports idempotent no-op

#### Scenario: Incomplete path rejected before writes
- **WHEN** project at `0.10.1` requests `0.11.0` but registry only has `0.10.1→0.10.2`
- **THEN** diff/update exit non-zero with `no update path from 0.10.2 to 0.11.0: missing ...`

#### Scenario: updatePath metadata surfaced
- **WHEN** registry entry declares `breakingNotes: "X"`
- **THEN** dry-run output includes that note for operator review

### Requirement: requiresManual blocks automatic apply

If any `Update` in the resolved path declares `requiresManual` non-empty, `generator:update --apply` SHALL be blocked until the manual condition has an explicit safe confirmation mechanism. The tool SHALL NOT add a global `--force` to bypass conflicts or manual steps.

#### Scenario: Manual step blocks apply
- **WHEN** path contains an update with `requiresManual: ["review tenancy migration"]`
- **THEN** `generator:update --apply` exits non-zero listing that manual requirement, without mutating files

### Requirement: Registry execution is ordered and recorded

When `--apply` is allowed, steps SHALL execute in registry order, SHALL run each step's `plan` callbacks if defined, SHALL roll back prior steps if a later step fails, and SHALL append each step's `id` to `manifest.appliedUpdates` exactly once and only after success.

#### Scenario: Order enforced
- **WHEN** fixtures register `0.10.1→0.10.2 (id A)` then `0.10.2→0.11.0 (id B)`
- **THEN** apply runs A before B

#### Scenario: Rollback spans multiple steps
- **WHEN** step B throws
- **THEN** files touched by A are restored and `appliedUpdates` does not contain A or B (atomic)

#### Scenario: Recorded IDs are registry IDs not generic strings
- **WHEN** update `0.10.1→0.11.0` succeeds with id `0.10.1-to-0.11.0`
- **THEN** `appliedUpdates` contains `0.10.1-to-0.11.0` not `0.10.1->0.11.0` generic arrow string

### Requirement: postValidations from registry extend base validations

Registry-declared `postValidations` SHALL be resolved against an allow-list (`manifest` check, `typecheck`, `lint`, `test`, `generator-smoke`) and executed as part of the update's validation phase with the same rollback semantics.

#### Scenario: Registry validation runs
- **WHEN** an update declares `postValidations: ["lint"]`
- **THEN** update --apply runs `lint` and failure triggers rollback as with typecheck

