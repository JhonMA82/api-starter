# generator-diff Specification

## Purpose
Shows a safe, read-only preview of what would change when upgrading a project to a newer starter version, classifying each file as safe or conflicting.
## Requirements
### Requirement: Diff is read-only and classification-complete

`generator:diff -- --project=<dir> --to=<version>` SHALL materialize the canonical target for exactly the project's feature set, classify every path as `add`, `update-safe`, `remove-safe`, `unchanged`, `customized-no-upstream-change`, `conflict`, or `manual-migration`, explain per-file why it is a conflict, exit non-zero when any conflict or invalid state exists, support `--json`, and require no network when run from the target starter checkout.

#### Scenario: Intact file shows update-safe

- **WHEN** upstream `apps/api/src/http/logger.ts` changed between baseline and target but local file equals baselineHash
- **THEN** diff lists that file as `update-safe`

#### Scenario: Customized file with upstream change shows conflict

- **WHEN** local file differs from baselineHash and upstream canonical also differs from baseline
- **THEN** diff lists it as `conflict` with reason "locally customized and upstream also changed; not overwritten"

#### Scenario: Diff does not write

- **WHEN** diff runs
- **THEN** no file under `--project` is modified (verified by hashing before/after)

### Requirement: Diff --json is machine-readable

`--json` SHALL emit a top-level object `{ project, to, fromVersion, toVersion, files: [{ path, classification, reason, strategy }] , migrations?: [...] }` with stable ordering.

#### Scenario: CI parses diff JSON

- **WHEN** `generator:diff -- --project=/tmp/proj --to=0.3.0 --json` runs
- **THEN** its stdout is valid JSON matching the schema and contains no colors or human prose mixed in

### Requirement: Diff validates and reports canonical version truth

`generator:diff` SHALL resolve the starter's canonical version from the starter repository root (not the consumer project's `process.cwd()`), SHALL require `--to` to either be omitted (defaulting to canonical) or to exactly match the canonical version, and SHALL reject with a clear non-zero error before any materialization if `--to` is missing-and-required, malformed, or mismatched. The JSON output `toVersion`, human header, and `UpdatePlan.toVersion` SHALL all equal the verified canonical version, never the raw user string when it diverges.

#### Scenario: Diff with mismatched --to is rejected read-only
- **WHEN** `bun run generator:diff -- --project=/tmp/proj --to=99.0.0 --json` runs while canonical is `0.11.0`
- **THEN** the command exits non-zero, emits `{ valid:false, error:"version mismatch: --to 99.0.0 != canonical 0.11.0" }` (or equivalent), and no file under `--project` is modified

#### Scenario: Diff without --to defaults to canonical
- **WHEN** `bun run generator:diff -- --project=/tmp/proj --json` runs (or with `--to 0.11.0` matching canonical)
- **THEN** output reports `toVersion: "0.11.0"` equal to the starter's `package.json` version and classification proceeds

#### Scenario: Diff JSON and human header agree on canonical version
- **WHEN** diff succeeds for a project at `0.10.1`
- **THEN** JSON `toVersion`, human `diff: ... (0.10.1 → 0.11.0)` line, and `buildUpdatePlan().toVersion` all equal the canonical package version

### Requirement: Diff surfaces registry path in dry-run

When `resolveUpdatePath(fromVersion, canonicalVersion)` yields steps, `generator:diff` SHALL include in its dry-run output the ordered `updatePath` IDs, `breakingNotes`, `requiresManual`, and `postValidations` declared by the registry, and SHALL mark the run invalid if the path is incomplete, a downgrade is requested, or no path exists for the requested jump.

#### Scenario: Missing update path is reported in diff
- **WHEN** a project at `0.10.1` diffs to `0.11.0` but registry lacks that edge
- **THEN** diff exits non-zero with message indicating incomplete path and does not claim the update is safe

#### Scenario: Diff shows breaking notes and manual requirements
- **WHEN** registry entry for `0.10.1→0.11.0` declares `breakingNotes` and `requiresManual`
- **THEN** diff JSON/human output lists those fields so the user knows action is required before apply

### Requirement: Diff remains pure read-only

`generator:diff` SHALL NOT write to the project, manifest, lockfile, or create backups; dry-run is pure. Multiple consecutive diffs with identical inputs SHALL produce byte-identical JSON aside from timestamps if any.

#### Scenario: Consecutive diffs are idempotent
- **WHEN** diff is run twice with same `--project` and `--to`
- **THEN** file hashes under `--project` are unchanged and second JSON `files` array equals the first

