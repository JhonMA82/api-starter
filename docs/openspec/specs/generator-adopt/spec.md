# generator-adopt Specification

## Purpose
Allows existing projects that only have `GENERATED.md` to migrate to the new versioned manifest with a verifiable, non-guessy adoption flow.
## Requirements
### Requirement: Adopt reads legacy marker only as migration input

`generator:adopt` SHALL read `GENERATED.md` only to extract legacy `profile` and `features`, validate them against the current catalog (rejecting unknown/conflicting sets), compare known files against the declared baseline version's canonical hashes, generate a pre-write report, and create `.api-starter/manifest.json` only if state is sufficiently verifiable.

#### Scenario: Legacy project adoption succeeds

- **WHEN** `bun run generator:adopt -- --project=/tmp/legacy --baseline=0.10.1` where legacy has unmodified files
- **THEN** it prints a report showing each known file as "intact" vs "customized", then writes a valid manifest with baselineHash equal to current content for intact files and notes customized ones

### Requirement: Divergent files are marked customized, not assumed intact

Any managed file whose current hash differs from the baseline canonical hash SHALL be recorded in the manifest as customized/conflicting context (not as intact), and the report SHALL list it with reason.

#### Scenario: Customized file adoption

- **WHEN** the legacy project modified `apps/api/src/app.ts`
- **THEN** `generator:adopt` reports that file as divergent/customized and does not set its baselineHash to the current divergent content as if it were canonical

### Requirement: Adoption does not guess baseline

If baseline cannot be proven (missing/ambiguous `GENERATED.md` markers, unknown baseline version, or inability to materialize that version's canonical tree), `generator:adopt` SHALL fail with an actionable error and SHALL NOT write a manifest.

#### Scenario: Unknown baseline guessed is rejected

- **WHEN** `generator:adopt -- --project=/tmp/legacy` is run without `--baseline` and `GENERATED.md` lacks a decipherable version
- **THEN** it exits non-zero stating baseline version is required and does not write a manifest

### Requirement: Legacy read support with deprecation warning

For at least one version, `add:feature` and `doctor` SHALL still be able to read `GENERATED.md` when no manifest exists, but SHALL emit a deprecation warning advising to run `generator:adopt`.

#### Scenario: Tool reads legacy project with warning

- **WHEN** a tool runs against a `GENERATED.md`-only project
- **THEN** it prints a deprecation warning referencing `generator:adopt` and proceeds (if behavior is still supported), rather than failing silently

