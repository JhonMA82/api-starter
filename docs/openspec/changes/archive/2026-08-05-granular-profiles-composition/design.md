## Context

See proposal.md - Why. Current generator has 5 profiles (minimal, data-api, authenticated, multi-tenant, platform) and a pure `planProject(profileId)` that assumes a named profile. `generator:validate` only checks basic feature-set validity per profile. `create:project` copies the repo tree then prunes via `computeRemoveList`. No `--features`/`--with` path exists and no shared `planFeatureSet` deduplication.

Constraints:
- Keep physical pruning, no runtime feature flags.
- `domain ← application ← http` and packages/modules layering preserved; generator must not import Hono/Bun.
- `bun.lock` and pins must stay exact; `platform` must track full feature union.
- `multi-tenant` cannot change silently; backward compat with deprecation warning required.

## Goals / Non-Goals

**Goals:**
- Add curated profiles `multi-tenant-core` and `integration-platform` with correct feature unions.
- Add deprecation metadata and CLI warning for `multi-tenant`.
- Support `--features` and `--profile --with` custom compositions with transitive closure and conflict rejection.
- Provide `--list-profiles`/`--list-features` discoverability in a deterministic, CI-friendly way.
- Consolidate planning into one pure planner reused everywhere.
- Strengthen `generator:validate` to cover uniqueness, known features, transitive deps, conflicts, cycles, ordering, deprecated replacement validity, and platform completeness.

**Non-Goals:**
- Versioned manifest (next change).
- Update engine (doctor/diff/update) and migrations.
- File-strategy merging for structured files.
- Governance ADR/template (later change).
- Interactive CLI wizard.

## Decisions

### Decision 1: Extend profiles.json with optional deprecation fields
- **Choice:** Add to `ProfileDefinition` interface: `deprecated?: boolean`, `deprecatedReason?: string`, `replacementProfiles?: string[]`, keeping `id/description/features` required. Persist in `generator/profiles.json`.
- **Rationale:** Explicit metadata matches spec §4.1 example and allows validation to check replacement existence without hard-coding.
- **Alternative:** Use separate `deprecatedProfiles.json` - rejected (fragments catalog, complicates validate).
- **Warning policy:** In `create-project.ts` after `planProject`, if `profile.deprecated` log to `console.warn` with `⚠ Profile "multi-tenant" is deprecated... Use one of: multi-tenant-core, integration-platform, platform. Reason: ...` and continue. Test asserts stderr capture.

### Decision 2: Keep physical pruning model; reuse `computeRemoveList`
- **Choice:** Custom compositions still produce a `ProjectPlan` (same `keep*/remove*` lists) and flow through existing copy→prune→rewrite→template pipeline.
- **Rationale:** No runtime flags; updater later reuses same materialization for diff.
- **Alternative:** Feature flag at runtime - rejected (violates non-negotiable principle 2).

### Decision 3: Single pure planner `planFeatureSet` + `planFromSelection`
- **Choice:** Export `planFeatureSet(features, profileId="custom")` (pure, validates, sorts). Add `planFromSelection({ profile?, features?, with?: })` that:
  1. Mutually excludes `--features` and `--with` (error if both supplied with distinct bases).
  2. Starts from profile features or empty.
  3. Merges `--with`/`--features` CSV, splits, trims, dedups.
  4. Resolves transitive closure by iterating `getFeature(id).requires` until fixpoint (or BFS), detecting cycles.
  5. Sorts deterministically (alphabetical) and validates via `validateFeatureSet`.
  6. Returns `ProjectPlan`.
- **Rationale:** One logic path prevents drift between create, validate, add-feature, diff/update.
- **Alternative:** Separate resolvers per command - rejected (duplication already flagged in spec §6).

### Decision 4: CLI extensions for create:project
- **New flags:** `--features=<csv>`, `--with=<csv>`, `--list-profiles`, `--list-features`, `--help` detail.
- **Parsing:** Keep manual argv loop (no extra dependency); `--features` sets `customFeaturesCsv`, `--with` sets `withCsv`. If `--list-profiles`/`--list-features` present, short-circuit to print and exit 0 without requiring `--profile`/`--out`.
- **Ambiguity rule:** If `--features` is supplied, `--profile` is ignored unless `--with` semantics explicitly requested? Spec requires no ambiguity: implement as:
  - `--features` alone → custom profile id `"custom"`.
  - `--profile X --with Y` → base X plus Y.
  - `--features` + `--profile` without `--with` → error: "ambiguous: use either --profile or --features, not both".
  - `--features` + `--with` → error similarly.
- **Deterministic plan display:** Before copy, `printSummary(plan, outPath)` already shows features; ensure custom path prints same and logs resolved features in sorted order.

### Decision 5: Generator validate strengthening
- **Checks added to `generator/src/validate.ts` + `cli-validate.ts`:**
  1. Duplicate profile ids.
  2. Unknown feature ids per profile.
  3. Missing transitive requirements (via validateFeatureSet).
  4. Conflicts via excludedBy.
  5. Cycle detection in requires graph (DFS).
  6. Deterministic ordering: `features` array must be sorted alphabetically (or at least stable vs sorted copy; fail if not).
  7. Deprecated: if `deprecated` true then `replacementProfiles` must be non-empty and every id must exist as profile; if deprecated falsy then replacementProfiles must be absent/empty.
  8. Platform completeness: `platform.features` sorted must equal sorted union of all feature ids except `dynamicRoles` and any future `excludedBy`-deferred (currently only dynamicRoles). Validate that platform includes observability, persistence, etc.
  9. Profile order stable (file order must be sorted by id? or at least validate no duplicates - we check file is deterministic).
- **Implementation:** New `validateCatalog()` function that reads `PROFILES` and `FEATURES` constants (which are generated from JSON). Use in `cli-validate.ts` for `generator:validate` exit codes. Support `--list-profiles`/`--list-features` there as well for agent ergonomics, sharing formatting code with create-project.

### Decision 6: No new dependencies
- **Choice:** Use only `node:fs`, `node:path`, existing `zod` for env if needed (not for profiles).
- **Rationale:** Keep generator lightweight per AGENTS.md pins.

## Risks / Trade-offs

- **[Risk] `--profile --with` transitive closure may pull unexpected deps** → Mitigation: always print final resolved feature list before materialization and require deterministic alphabetical order so user sees full set.
- **[Risk] `multi-tenant` warning noise in CI** → Mitigation: warning goes to stderr, not stdout; tests assert presence only when that profile is selected. Document deprecation date (e.g., "reconsider removal in 0.11.0").
- **[Risk] Alphabetical ordering may surprise existing profiles that were manually ordered** → Mitigation: update `profiles.json` to store features alphabetically; validate enforces it so drift is caught in CI.
- **[Risk] Feature `observability` currently empty (no modules/migrations) but platform must include it** → Mitigation: platform completeness check explicitly excludes deferred features set, which currently includes only `dynamicRoles`; observability is required, so platform already lists it.

## Migration Plan

- **Steps:**
  1. Update `generator/profiles.json` and `generator/src/profiles.ts` types/fixtures.
  2. Implement `planFromSelection` and extend `create-project.ts` CLI.
  3. Strengthen `validate.ts`/`cli-validate.ts`.
  4. Update tests (`catalog.test.ts`, `create-project.test.ts`) to expect new profiles and flags.
  5. Regenerate docs (`docs/architecture.md` profiles table, README).
- **Rollback:** Revert JSON and code; `multi-tenant` still works (deprecated path is additive).

## Open Questions

- None. Feature ordering canonical choice (alphabetical) is the documented deterministic rule; if team prefers dependency-order, validate must still enforce a single stable comparator.

