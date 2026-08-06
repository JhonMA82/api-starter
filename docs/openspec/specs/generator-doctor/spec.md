# generator-doctor Specification

## Purpose
Detects drift, customization and configuration errors in generated projects without mutating them, so users can decide safely before updating.
## Requirements
### Requirement: Doctor detects core invalid states

`generator:doctor -- --project=<dir>` SHALL detect at least: missing/invalid manifest, unsupported schemaVersion, unknown starter version, invalid/conflicting features, missing managed file, modified managed file (hash mismatch), stale hashes, declared but unapplied migrations, inconsistent composition vs features, verifiable residual files from disabled features, and git dirty as warning not error. It SHALL output human text by default and `--json` as structured array.

#### Scenario: Clean project passes

- **WHEN** doctor runs on a freshly materialized `platform` project with manifest intact
- **THEN** it exits zero reporting no errors (only optional extra untracked files advisories), and `--json` output is parseable and empty for errors

#### Scenario: Modified managed file flagged

- **WHEN** `apps/api/src/app.ts` (strategy managed) is edited after generation
- **THEN** doctor reports that path with code `managed-modified` and severity error, noting baseline vs current hash mismatch

#### Scenario: Missing managed file flagged

- **WHEN** a managed file is deleted
- **THEN** doctor reports `managed-missing` error for that path

#### Scenario: Git dirty is warning only

- **WHEN** the project has uncommitted changes but manifest issues are otherwise clean
- **THEN** doctor reports a `git-dirty` warning but still exits zero

