## 1. Catalog and type updates

- [ ] 1.1 Extend `ProfileDefinition` in `generator/src/profiles.ts` with `deprecated?: boolean`, `deprecatedReason?: string`, `replacementProfiles?: readonly string[]` and update `PROFILES` constant to include `multi-tenant-core` and `integration-platform` profiles plus deprecated metadata for `multi-tenant`
- [ ] 1.2 Update `generator/profiles.json` to match the TypeScript source (six plus one deprecated entry, features alphabetically sorted, replacement profiles valid) and ensure `generator/src/profiles.ts` export stays in sync
- [ ] 1.3 Update `ALL_MIGRATIONS`/`ALL_MODULES`/`ALL_PACKAGES` guards in `generator/src/plan.ts` if needed and ensure `planFeatureSet` sorts features deterministically

## 2. Pure planner consolidation

- [ ] 2.1 Implement/extend `planFeatureSet(features, profileId)` to validate, transitive-close, sort, and build `ProjectPlan` as the single source of truth; add `planFromSelection({ profile, features, with: withFeatures })` handling mutual exclusion and CSV parsing
- [ ] 2.2 Refactor `planProject(profileId)` to delegate to `planFeatureSet` after `validateProfile`, and ensure `add-feature.ts` also delegates (if touched) rather than re-implementing
- [ ] 2.3 Add cycle detection utility and deterministic ordering helpers used by the planner

## 3. CLI: custom composition and discoverability

- [ ] 3.1 Extend `generator/src/create-project.ts` argv parsing to support `--features=<csv>`, `--with=<csv>`, `--list-profiles`, `--list-features`, `--help`; implement ambiguity error ("use either --profile or --features") and deprecated-profile warning to stderr
- [ ] 3.2 Extract listing formatters (profile/feature catalog printers) shared with `cli-validate.ts` so both commands support `--list-profiles`/`--list-features` consistently
- [ ] 3.3 Ensure plan summary prints final resolved feature list before materialization and that custom `profile` id is "custom" when `--features` is used

## 4. Validation hardening

- [ ] 4.1 Extend `generator/src/validate.ts` with `validateCatalog()` covering: duplicate ids, unknown features, missing transitive requirements, conflicts, cycles, ordering, deprecated replacement validity, and `platform` == full feature union excluding `dynamicRoles`
- [ ] 4.2 Update `generator/src/cli-validate.ts` to use the new catalog validator, wire `--profile=<id>` filtering plus `--list-profiles`/`--list-features` flags, and produce non-zero exit with actionable messages
- [ ] 4.3 Add helper to detect deterministic ordering violations and test it against intentionally unsorted fixtures

## 5. Tests

- [ ] 5.1 Update `generator/tests/catalog.test.ts` to assert the seven profile ids (including deprecated multi-tenant), their exact feature sets, deprecation metadata, deterministic ordering, and platform completeness
- [ ] 5.2 Extend `generator/tests/create-project.test.ts` with cases for: deprecated warning capture, `--features` custom composition prunes correctly, `--profile --with` merges transitively, `--features` conflict rejected, `--list-*` flags output deterministically, and ambiguity errors
- [ ] 5.3 Add unit tests for `planFeatureSet`/`planFromSelection`: transitive closure (e.g., webhooks→tenancy+jobs), cycle rejection, conflict via `excludedBy`, and idempotent sorting

## 6. Docs and baseline verification

- [ ] 6.1 Update `docs/architecture.md` profiles table and `README.md` generation section to document the six curated profiles, deprecated `multi-tenant`, and custom `--features`/`--with` interfaces
- [ ] 6.2 Run baseline matrix: `bun run lint`, `bun run typecheck`, `bun test`, `bun run generator:validate`, and materialize each profile to `/tmp` (`minimal`, `data-api`, `authenticated`, `multi-tenant-core`, `integration-platform`, `platform`) and verify each installs/types/tests
