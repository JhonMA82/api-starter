# Brainstorm Summary

- Change: granular-profiles-composition
- Date: 2026-08-06

## Confirmed Technical Approach

- Extending ProfileDefinition with deprecated metadata and adding multi-tenant-core / integration-platform profiles
- Pure planner consolidation: planFeatureSet + planFromSelection with transitive closure, deterministic alphabetical ordering, and single validation path
- CLI extensions: --features, --with, --list-profiles, --list-features plus deprecation warning on stderr
- Strengthened generator:validate with catalog-wide checks (unique IDs, unknown features, cycles, platform completeness)

## Key Trade-offs and Risks

- Transitive closure may surprise users → mitigate by printing final resolved feature list
- Warning noise in CI → stderr only
- Ordering enforcement may break existing unsorted profile files → updated to alphabetical and gated in CI

## Testing Strategy

- Profile matrix: each profile materializes and passes lint/typecheck/test
- Deprecation warning asserted via stderr capture
- Custom composition via --features and --profile --with with transitive deps
- Validator unit tests for ordering, cycles, platform completeness, deprecated replacements

## Spec Patches

- None pending - delta specs already cover granular profiles and composition
