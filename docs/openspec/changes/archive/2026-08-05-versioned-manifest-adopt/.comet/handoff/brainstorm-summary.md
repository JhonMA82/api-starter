# Brainstorm Summary

- Change: versioned-manifest-adopt
- Date: 2026-08-06

## Confirmed Technical Approach

- Manifest schema v1 with starter, generation, managedFiles (sha256 + strategy), appliedUpdates; atomic temp→rename, stable key ordering, strict validation
- Hashing via node:crypto SHA256
- Materialize helper reusing generateProjectFromPlan for canonical trees
- Adopt flow parsing GENERATED.md, validating profile/features, materializing baseline to temp, hash-compare, report, write only when verifiable

## Key Trade-offs and Risks

- Baseline materialization for old version may be approximate → mark mismatches as customized
- .api-starter not gitignored → committed for drift detection

## Testing Strategy

- Valid creation, stable serialization, future schema rejection, unknown feature rejection, hash stability, atomic write, add:feature update, legacy read warning, adopt with divergences

## Spec Patches

- None
