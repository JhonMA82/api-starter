# generator-update Specification

## Purpose
Applies safe upstream changes to a project without overwriting personalizations, with backup, validation and rollback guarantees.
## Requirements
### Requirement: Update respects customizations and is explicit

Without `--apply`, `generator:update` SHALL operate as dry-run (same output as diff). With `--apply` it SHALL NOT overwrite any file classified as `conflict` or `customized-no-upstream-change`, SHALL NOT expose a global destructive `--force`, SHALL abort by default when conflicts exist, SHALL create a backup per touched file under `.api-starter/backups/<timestamp>/` ignored by Git, SHALL apply operations deterministically sorted, SHALL run post-validations (typecheck/tests) and on failure SHALL revert touched files and SHALL NOT bump the manifest.

#### Scenario: Dry-run does not mutate

- **WHEN** `generator:update -- --project=/tmp/proj --to=0.3.0` (no --apply) on a project with an `update-safe` file
- **THEN** the project's file stays at baseline hash and exit code is zero (or non-zero if conflicts exist - matching diff semantics)

#### Scenario: Conflict prevents apply

- **WHEN** a project has at least one `conflict` file and `generator:update -- --project=/tmp/proj --to=0.3.0 --apply` is run
- **THEN** no file is overwritten, backups are not created, and the command exits non-zero listing the conflicting paths

#### Scenario: Successful update bumps manifest only on success

- **WHEN** only `update-safe`/`add`/`remove-safe` operations exist and post-validations pass and `--apply` is given
- **THEN** the listed files are updated to target canonical content, `.api-starter/manifest.json` is updated to new baselineHashes and `updatedAt`/`starter.version`, and a second run reports no changes (idempotent)

#### Scenario: Failed post-validation rolls back

- **WHEN** an update would introduce a type error and `bun x tsc --noEmit` fails post-apply
- **THEN** the updater restores all touched files from backups, leaves the manifest unchanged from before the run, and exits non-zero

### Requirement: Structured files are merged not overwritten

For files with strategy `structured`, `generator:update` SHALL parse and merge only managed keys (e.g., keep user scripts/deps in `package.json`, key-wise merge in `.env.example`), preserve foreign keys, and order only managed sections without reformatting the entire file unnecessarily. It SHALL never modify `.env`.

#### Scenario: Package.json merge preserves user script

- **WHEN** `package.json` has a user-added script `my:script` and upstream adds a new dependency
- **THEN** after `generator:update --apply`, `my:server` (user's) remains, upstream dep is added, and user script is not removed

