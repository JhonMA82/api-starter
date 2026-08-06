# generator-profiles Specification

## Purpose
Defines granular, curated API-starter profiles and their deprecation/validation contract so generators can materialize only the needed capabilities without combinatorial explosion.
## Requirements
### Requirement: Granular profile set exists

The generator SHALL expose exactly these six curated profiles with the listed feature sets:
- `minimal`: []
- `data-api`: [persistence]
- `authenticated`: [persistence, auth, authorization]
- `multi-tenant-core`: [persistence, auth, authorization, tenancy, audit]
- `integration-platform`: [persistence, auth, authorization, tenancy, audit, apiKeys, jobs, webhooks]
- `platform`: [persistence, auth, authorization, tenancy, audit, apiKeys, jobs, webhooks, files, notifications, observability]

#### Scenario: User lists profiles

- **WHEN** user runs `bun run generator:validate -- --list-profiles` or `bun run create:project -- --list-profiles`
- **THEN** the output lists the six profiles above with their description and feature list in deterministic alphabetical order

#### Scenario: Each granular profile materializes correctly

- **WHEN** `bun run create:project -- --profile=<each of the six>` is executed to a fresh directory
- **THEN** `bun install && bun run typecheck && bun test` succeed, and pruned modules/packages/migrations match the feature set exactly (no residual files from excluded features)

### Requirement: Legacy multi-tenant alias is deprecated but preserved

The profile identifier `multi-tenant` SHALL remain resolvable to its current full feature set [persistence, auth, authorization, tenancy, audit, apiKeys, jobs, webhooks, files, notifications] but SHALL be marked `deprecated: true` with `replacementProfiles: ["multi-tenant-core", "integration-platform", "platform"]` and a deprecation reason mentioning its planned reconsideration for removal. Selecting it SHALL emit a conspicuous warning to stderr recommending the three replacements but MUST still generate a valid project.

#### Scenario: User selects deprecated multi-tenant

- **WHEN** user runs `bun run create:project -- --profile=multi-tenant --out=/tmp/x`
- **THEN** the generator prints a warning containing the words "deprecated" and each of "multi-tenant-core", "integration-platform", "platform" and still completes materialization with the full feature set

#### Scenario: Validation accepts deprecated profile with valid replacements

- **WHEN** `bun run generator:validate` is executed
- **THEN** it passes when `multi-tenant` has deprecated=true and every replacement profile id exists; it fails if a replacement id is unknown or if a non-deprecated profile lists replacements

### Requirement: Profile metadata supports explicit deprecation

The profile definition schema SHALL support optional `deprecated?: boolean`, `deprecatedReason?: string`, and `replacementProfiles?: string[]`. The catalog at `generator/profiles.json` MUST be validated for unique profile ids, known feature ids, transitive dependency satisfaction, conflict freedom, cycle freedom, deterministic ordering, and replacement validity.

#### Scenario: Validator catches invalid replacement

- **WHEN** a profile declares `deprecated: true` with `replacementProfiles: ["nonexistent"]`
- **THEN** `bun run generator:validate` exits non-zero and reports `unknown-profile` for the replacement

### Requirement: Platform profile is the complete feature set

The `platform` profile SHALL contain exactly the union of all currently supported features except those explicitly declared deferred/incompatible (`dynamicRoles`). The validator SHALL enforce this invariant so adding a new feature requires updating `platform`.

#### Scenario: New feature not added to platform is caught

- **WHEN** a new feature `newFeature` is added to `features.json` without adding it to `platform.features`
- **THEN** `bun run generator:validate` reports that `platform` does not represent the complete feature set

### Requirement: Validation verifies deterministic ordering and uniqueness

The validator SHALL enforce that profile ids are unique, feature ids within each profile are sorted deterministically, and the overall catalog order is stable.

#### Scenario: Unsorted profile features detected

- **WHEN** a profile lists features in non-alphabetical order (e.g., `["auth","persistence"]`)
- **THEN** `bun run generator:validate` reports an ordering violation

