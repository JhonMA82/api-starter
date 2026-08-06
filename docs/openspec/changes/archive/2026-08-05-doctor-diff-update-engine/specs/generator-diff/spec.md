## Purpose

Shows a safe, read-only preview of what would change when upgrading a project to a newer starter version, classifying each file as safe or conflicting.

## ADDED Requirements

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

