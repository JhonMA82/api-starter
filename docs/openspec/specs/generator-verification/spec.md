# generator-verification Specification

## Purpose
Provides a reproducible audit report and E2E harness that proves generated-project update safety, preventing regressions of version-truth, merge-preservation, and rollback invariants.
## Requirements
### Requirement: Verification report matrix

The change SHALL deliver `docs/verification-generated-project-update-vnext.md` containing a row per observation O1–O8 with columns `ID | Observation | State | Evidence | Action`, where `State ∈ { CONFIRMED, PARTIALLY_CONFIRMED, REJECTED, ALREADY_FIXED }` and `Evidence` cites at least one of: call flow reference, reproducing test, CLI output, hash/file comparison, or passing test proof.

#### Scenario: Matrix completeness
- **WHEN** `docs/verification-generated-project-update-vnext.md` is inspected
- **THEN** it has rows O1 through O8 and no row lacks evidence or action text

### Requirement: E2E update cycle covered in temp harness

An integration suite SHALL exercise the full cycle in a temp directory (no real project mutation): fixture at prior version → adopt or load manifest → personalize `package.json` script, dep, `.env.example` key, managed conflict file, unmanaged domain file → `doctor` → `diff` → assert safe/conflict/canonical version → resolve conflict → `update --apply` → verify merges, hashes, `appliedUpdates`, validations, backup → repeat update for idempotence → force validation failure → confirm rollback.

#### Scenario: E2E harness passes
- **WHEN** `bun test generator/tests/e2e-update.test.ts` runs (or equivalent)
- **THEN** all steps above are asserted and temp dirs cleaned up

### Requirement: Negative and edge cases

The suite SHALL also cover `--to` fictitious, downgrade, missing path, two-step path, manual block, custom adopt hash, unmaterializable baseline, invalid structured JSON, `.env` untouched, upstream-removed-but-customized, upstream-new-but-local-exists-different, copy failure rollback, subdirectory paths, and stable `--json` output.

#### Scenario: Coverage of edges
- **WHEN** the negative-case tests run
- **THEN** each listed edge either fails with expected error or produces expected classification without silent overwrite

