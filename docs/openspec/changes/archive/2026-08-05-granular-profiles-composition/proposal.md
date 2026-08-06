## Why

The current `multi-tenant` profile bundles 10 features (persistence + auth + tenancy + audit + apiKeys + jobs + webhooks + files + notifications) into a single preset, mixing core SaaS tenancy with optional integration/product capabilities. Teams needing only a database, or only core tenancy without integrations, must fork or manually prune. A finer-grained profile set and explicit custom-feature composition are required to keep `api-starter` a code factory without combinatorial profile explosion, while preserving backward compatibility with the existing `multi-tenant` identifier.

## What Changes

- Add three new first-class profiles:
  - `multi-tenant-core` = persistence, auth, authorization, tenancy, audit
  - `integration-platform` = multi-tenant-core + apiKeys, jobs, webhooks
  - `platform` already represents full capabilities (now verified to equal all non-deferred features)
- Keep `minimal`, `data-api`, `authenticated` unchanged.
- Keep `multi-tenant` temporarily with identical composition but marked `deprecated: true` and `replacementProfiles: ["multi-tenant-core", "integration-platform", "platform"]` with a clear CLI warning on use; document its future removal.
- Extend `generator/profiles.json` schema to support `deprecated`, `deprecatedReason`, `replacementProfiles` metadata.
- Add explicit custom composition interfaces:
  - `bun run create:project -- --features=persistence,auth,... --out=...`
  - `bun run create:project -- --profile=multi-tenant-core --with=files,notifications --out=...`
  - Mutual exclusion and conflict (`excludedBy`) checks, transitive dependency resolution, deterministic ordering.
- Add discovery flags `--list-profiles` and `--list-features` (and `generator:validate --list-profiles/--list-features` equivalents) for CI/agent discoverability.
- Extract single pure planner `planFeatureSet(features, profileId)` / `planFromSelection(...)` used by `create:project`, `add:feature`, and `generator:validate`; remove duplicated logic.
- Expand `generator:validate` to verify unique IDs, known features, transitive deps, conflicts, cycles, deterministic order, deprecated replacements validity, and that `platform == all features` excluding `dynamicRoles` (deferred/incompatible).

## Capabilities

### New Capabilities
- `generator-profiles`: granular profile definitions, deprecation metadata, and deterministic validation guarantees for the profile/feature catalog.
- `generator-composition`: custom feature-set materialization without requiring a named profile, with transitive closure and conflict rejection, used identically by create, validate, and future updater.

### Modified Capabilities
<!-- No existing spec-level capabilities are being modified; this change introduces new generator behavior. -->

## Impact

- Affects: `generator/profiles.json`, `generator/features.json`, `generator/src/plan.ts`, `generator/src/profiles.ts`, `generator/src/features.ts`, `generator/src/validate.ts`, `generator/src/create-project.ts`, `generator/src/add-feature.ts`, `generator/src/cli-validate.ts`, `generator/tests/*`, `package.json` scripts, `docs/architecture.md` and `README.md`.
- CLI contract: new flags `--features`, `--with`, `--list-profiles`, `--list-features` added; existing `--profile`/`--out`/`--force` behavior preserved.
- No runtime impact on `apps/api`, `packages/*`, `modules/*` beyond what the existing pruning already covers.
- Tests: profile matrix, deprecation warnings, custom composition, deterministic ordering, and catalog validation.
