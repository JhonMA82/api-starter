## ADDED Requirements

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
