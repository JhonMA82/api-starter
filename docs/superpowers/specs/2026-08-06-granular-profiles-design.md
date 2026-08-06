---
comet_change: granular-profiles-composition
role: technical-design
canonical_spec: openspec
archived-with: 2026-08-05-granular-profiles-composition
status: final
---

# Technical Design: Granular Profiles and Custom Composition

## Context

See `docs/openspec/changes/granular-profiles-composition/proposal.md` - Why, What Changes, Capabilities. Current `generator/profiles.json` defines 5 profiles (minimal, data-api, authenticated, multi-tenant, platform) and `planProject(profileId)` assumes a named profile. `generator:validate` only validates per-profile feature sets superficially. `create:project` does copy→prune→rewrite→template and emits `GENERATED.md`. No custom `--features`/`--with` path exists.

Constraints:
- Physical pruning stays (no runtime flags)
- `domain ← application ← http` preserved; generator never imports Hono/Bun
- Pins exact, `bun.lock` committed, `packageManager: bun@1.3.14`
- Backward compat for `multi-tenant` required with explicit deprecation warning
- CLI must stay deterministic and CI-friendly (no interactive wizard)

OpenSpec handoff: `docs/openspec/changes/granular-profiles-composition/.comet/handoff/design-context.md` (hash fe2fc9...), specs `generator-profiles` and `generator-composition`.

## Goals / Non-Goals

**Goals:**
- 7 profile ids (6 curated + 1 deprecated alias) with correct feature unions
- Deprecated metadata typed and validated
- Custom composition via `--features` and `--profile --with` with transitive closure
- Discoverability via `--list-profiles`/`--list-features`
- Single pure planner reused by all entry points
- Validator hardening (9 checks)

**Non-Goals:**
- Manifest, doctor/diff/update, migrations, governance ADR — delegated to batch siblings
- Runtime split of generated vs extension seams beyond strategy tagging
- Interactive mode

## Technical Approach

### 1. Data Model: ProfileDefinition extension

```ts
// generator/src/profiles.ts
export interface ProfileDefinition {
  id: string;
  description: string;
  features: readonly string[];
  deprecated?: boolean;
  deprecatedReason?: string;
  replacementProfiles?: readonly string[];
}
export const PROFILES: readonly ProfileDefinition[] = [
  { id: "minimal", features: [] },
  { id: "data-api", features: ["persistence"] },
  { id: "authenticated", features: ["persistence","auth","authorization"] },
  { id: "multi-tenant", features: ["persistence","auth","authorization","tenancy","audit","apiKeys","jobs","webhooks","files","notifications"], deprecated: true, deprecatedReason: "Use multi-tenant-core/integration-platform/platform. Will be reconsidered for removal in 0.11.0", replacementProfiles: ["multi-tenant-core","integration-platform","platform"] },
  { id: "multi-tenant-core", features: ["persistence","auth","authorization","tenancy","audit"] },
  { id: "integration-platform", features: ["persistence","auth","authorization","tenancy","audit","apiKeys","jobs","webhooks"] },
  { id: "platform", features: ["persistence","auth","authorization","tenancy","audit","apiKeys","jobs","webhooks","files","notifications","observability"] },
];
```

`generator/profiles.json` mirrors this array (alphabetically sorted by id). A sync check `generator:validate --check-profiles-sync` could assert JSON ↔ TS parity, but minimal parity is tested via `catalog.test.ts` that imports `PROFILES` and reads JSON and deep-equals.

Features stay in `generator/features.json` and `generator/src/features.ts` unchanged except validator now needs deferred set: `const DEFERRED_FEATURES = new Set(["dynamicRoles"])`.

### 2. Pure planner consolidation

Current `planProject` and `planFeatureSet` are already close. Consolidation:

```ts
// generator/src/plan.ts
export function planFeatureSet(features: readonly string[], profileId = "custom"): ProjectPlan {
  const sorted = [...features].sort(); // deterministic
  const issues = validateFeatureSet(sorted);
  // ... throw on unknown/duplicate/conflict/missing (existing)
  // transitive closure already handled by validateFeatureSet missing-requirement check,
  // but we need explicit closure expansion:
  const closed = closeTransitive(sorted); // iteratively add requires until fixpoint, detect cycles
  return buildProjectPlan(profileId, closed.sort());
}

export function planFromSelection(opts: { profile?: string; featuresCsv?: string; withCsv?: string }): ProjectPlan {
  if (opts.featuresCsv && (opts.profile || opts.withCsv)) {
    throw new GenerationError("ambiguous: use either --profile or --features, not both");
  }
  if (opts.withCsv && !opts.profile) throw new GenerationError("--with requires --profile");
  if (opts.featuresCsv) {
    const feats = parseCsv(opts.featuresCsv); // split, trim, filter empty, dedup
    const closed = closeTransitive(feats);
    return planFeatureSet(closed, "custom");
  }
  if (opts.profile && opts.withCsv) {
    const base = getProfile(opts.profile);
    const extra = parseCsv(opts.withCsv);
    const merged = [...base.features, ...extra];
    const closed = closeTransitive([...new Set(merged)]);
    return planFeatureSet(closed, opts.profile);
  }
  // fallback to existing profile path
  return planProject(opts.profile!);
}

function closeTransitive(ids: string[]): string[] {
  const result = new Set(ids);
  const visiting = new Set<string>();
  function visit(id: string) {
    if (visiting.has(id)) throw new Error(`cycle detected at "${id}"`);
    visiting.add(id);
    for (const req of getFeature(id).requires) {
      if (!result.has(req)) { result.add(req); visit(req); }
    }
    visiting.delete(id);
  }
  for (const id of [...result]) visit(id);
  return [...result];
}
```

`buildProjectPlan` remains pure, computing keep/remove via sets and sorting alphabetically. Ordering of `features` in final `ProjectPlan` is also alphabetical to satisfy validator's deterministic rule.

### 3. CLI extensions: create:project

Refactor `main()` in `generator/src/create-project.ts`:

- Add flags: `--features`, `--with`, `--list-profiles`, `--list-features`, `--help`.
- Early dispatch: if `--list-profiles` or `--list-features`, call `printProfiles()`/`printFeatures()` and exit 0 without requiring `--out`. Both support `--json` optional flag for machine parsing but human table by default.
- Deprecation warning after resolving profile: `if (profile.deprecated) console.warn(`⚠ Profile "${profile.id}" is deprecated: ${profile.deprecatedReason}. Use one of: ${profile.replacementProfiles!.join(", ")}`)`.
- Use `planFromSelection` instead of directly calling `planProject`; if custom, `profileId` is `"custom"` and `plan.features` is logged.
- Existing `--profile`/`--out`/`--force` semantics unchanged.

Listing formatters extracted to `generator/src/list-formatters.ts` (or inline helpers) shared with `cli-validate.ts`:

```ts
function formatProfiles(profiles: readonly ProfileDefinition[], asJson: boolean) {
  if (asJson) return JSON.stringify(profiles, null, 2);
  return profiles.map(p => `${p.id.padEnd(22)} ${p.description} [${p.features.join(", ") || "(none)"}]${p.deprecated ? " (deprecated)" : ""}`).join("\n");
}
```

### 4. Validator hardening

`generator/src/validate.ts` gains exported `validateCatalog(): ValidationIssue[]` :

1. duplicate profile ids -> `duplicate-profile`
2. for each profile: unknown feature ids (already via `validateFeatureSet`),
3. missing transitive requirements & conflicts & excludedBy (via `validateFeatureSet`),
4. cycle detection via DFS on requires graph (return issue `cycle`),
5. ordering: `if (JSON.stringify(profile.features) !== JSON.stringify([...profile.features].sort()))` -> `ordering-violation`,
6. deprecated checks:
   - if `deprecated===true` then `replacementProfiles` non-empty and each exists
   - if `deprecated` falsy then `replacementProfiles` must be undefined/empty
7. platform completeness:
   ```ts
   const allMinusDeferred = FEATURES.map(f=>f.id).filter(id=>!DEFERRED_FEATURES.has(id));
   const platform = PROFILES.find(p=>p.id==="platform")!;
   if (JSON.stringify([...platform.features].sort()) !== JSON.stringify([...allMinusDeferred].sort())) issue
   ```
8. uniqueness of feature ids already covered.

`generator/src/cli-validate.ts` then:
- supports `--list-profiles`/`--list-features` early exit,
- supports `--profile=<id>` to filter validation to single profile (existing behavior, retain),
- otherwise runs `validateCatalog` and prints human or `--json` output, exits 1 on any error.

### 5. Tests matrix

- `catalog.test.ts`: asserts 7 profile ids, exact feature sets, deprecated fields, ordering, platform completeness, no cycles.
- `create-project.test.ts`: captures `console.warn` mock for `multi-tenant` warning, asserts `--features` produces pruned dirs identical to equivalent profile, `--profile --with` merges, conflict rejected, ambiguity errors, `--list-*` output, deterministic ordering.
- New helper `plan.test.ts` if needed but can stay inside `catalog.test.ts`.

## Data Flow

```
CLI args (--profile/--features/--with)
  → planFromSelection / planProject
    → validateFeatureSet + closeTransitive + ordering
      → buildProjectPlan (sets -> sorted arrays)
        → generateProject: cpSync filter -> computeRemoveList -> remove
          -> filterMigrationJournal -> rewrite* -> copy templates -> write GENERATED.md
            -> (future) write manifest
```

Validator reads static `PROFILES`/`FEATURES` constants, runs same `validateFeatureSet` + extra checks, never touches FS except for JSON sync test.

## Error Handling

- Unknown profile: `UnknownProfileError` (existing)
- Unknown feature: `UnknownFeatureError`
- Cycle: thrown as `Error` with cycle path; validator surfaces as `cycle` issue
- Ambiguity: `GenerationError` with actionable "use either --profile or --features"
- Deprecated warning: not an error, just `console.warn`
- Ordering violation: validator reports which profile and expected vs actual sorted list

## Testing Strategy

- Unit: `validateFeatureSet`, `closeTransitive`, `planFeatureSet` deterministic sorting
- Integration: `generator:validate` exit codes
- Pruning: materialize each of 7 profiles to `/tmp` in CI, run `bun install --frozen-lockfile` (but CI uses `bun test` without install), `bun x tsc --noEmit`, `bun test`; assert `computeKeepList`/`computeRemoveList` parity and no residual `modules/organizations` in `minimal`
- Deprecation warning test uses `spyOn(console, "warn")`

## Risks / Mitigations

- Risk: `closeTransitive` changes feature order expectation → sorted output mitigates
- Risk: `platform` drift when adding feature → validator catches, test fails until platform updated (intentional)
- Risk: JSON/TS parity drift → test imports both and deepEquals

## Migration / Rollback

Additive; revert JSON + TS file to restore 5 profiles. No DB migration.

## Open Questions

- None. Deterministic ordering is alphabetical as per validator; if team prefers dependency topological order, validator comparator can be swapped with single function change.
