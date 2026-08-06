---
change: granular-profiles-composition
design-doc: docs/superpowers/specs/2026-08-06-granular-profiles-design.md
base-ref: 71f00ca801f4fbe281440b06107dea9897276838
archived-with: 2026-08-05-granular-profiles-composition
---

# Granular Profiles and Custom Composition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Introduce `multi-tenant-core` and `integration-platform` curated profiles, deprecate `multi-tenant` with warning, enable custom `--features`/`--with` compositions with transitive closure, add discoverability flags, and harden catalog validation under a single pure planner.

**Architecture:** Extend `ProfileDefinition` with optional deprecation fields; keep `generator/profiles.json` as JSON mirror of `generator/src/profiles.ts`. Consolidate planning into pure `planFeatureSet`/`planFromSelection` with deterministic alphabetical ordering and cycle detection. Refactor `create-project.ts` CLI for new flags and share listing formatters with `cli-validate.ts`. Strengthen `validate.ts` with `validateCatalog()` covering 9 invariant families.

**Tech Stack:** Bun 1.3.14, TypeScript 7.0.2, Node `node:crypto`/`node:fs`/`node:path`, existing `validateFeatureSet`/`filterWorkspaceDependencies` utilities, Biome 2.5.6 lint.

## Global Constraints

- `packageManager: bun@1.3.14` and `.bun-version = 1.3.14` must not change
- `bun.lock` regenerated only via `bun install` (never hand-edited)
- `@hono/standard-validator` pinned at `0.2.3` exact (peer `^0.2.0`)
- Catalog JSON ordering must be stable/deterministic (alphabetical)
- `platform` must equal union of all non-deferred features (deferred = `dynamicRoles` only)
- Generator tooling must not import Hono/Bun at runtime; only Node APIs and local modules
- `domain ← application ← http` preserved; no new runtime dependencies in `packages/*` or `modules/*`

---

### Task 1: Extend ProfileDefinition and catalog JSON

**Files:**
- Modify: `generator/src/profiles.ts`
- Modify: `generator/profiles.json`
- Test: `generator/tests/catalog.test.ts` (existing)

**Interfaces:**
- Consumes: Existing `ProfileDefinition` {id, description, features}
- Produces: `ProfileDefinition` with optional `deprecated`, `deprecatedReason`, `replacementProfiles`; expanded `PROFILES` constant with 7 entries

- [x] **Step 1: Write failing test for new profiles**

```ts
// generator/tests/catalog.test.ts
import { PROFILES } from "../src/profiles";
test("profiles include multi-tenant-core and integration-platform and deprecated multi-tenant", () => {
  const ids = PROFILES.map(p => p.id).sort();
  expect(ids).toEqual(["authenticated","data-api","integration-platform","minimal","multi-tenant","multi-tenant-core","platform"]);
  const mt = PROFILES.find(p=>p.id==="multi-tenant")!;
  expect(mt.deprecated).toBe(true);
  expect(mt.replacementProfiles).toEqual(["multi-tenant-core","integration-platform","platform"]);
  const mtc = PROFILES.find(p=>p.id==="multi-tenant-core")!;
  expect([...mtc.features].sort()).toEqual(["audit","auth","authorization","persistence","tenancy"].sort());
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `bun test generator/tests/catalog.test.ts -v`
Expected: FAIL — missing profiles

- [x] **Step 3: Implement profile extension**

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
  { id: "authenticated", description: "Single-tenant applications with user accounts (spec §4.3)", features: ["auth","authorization","persistence"] },
  { id: "data-api", description: "APIs with persistence but no user accounts (spec §4.2)", features: ["persistence"] },
  { id: "integration-platform", description: "Platform integrating external systems with async processing (spec §4.5)", features: ["apiKeys","audit","auth","authorization","jobs","persistence","tenancy","webhooks"] },
  { id: "minimal", description: "Public APIs without persistence or user accounts (spec §4.1)", features: [] },
  { id: "multi-tenant", description: "One installation serving multiple organizations — deprecated, use multi-tenant-core/integration-platform/platform (spec §4.4 legacy)", features: ["apiKeys","audit","auth","authorization","files","jobs","notifications","persistence","tenancy","webhooks"], deprecated: true, deprecatedReason: "Use multi-tenant-core, integration-platform, or platform. Will be reconsidered for removal in 0.11.0.", replacementProfiles: ["multi-tenant-core","integration-platform","platform"] },
  { id: "multi-tenant-core", description: "SaaS multi-tenant core without integrations (spec §4.4 core)", features: ["audit","auth","authorization","persistence","tenancy"] },
  { id: "platform", description: "All production capabilities, including observability (spec §4.6)", features: ["apiKeys","audit","auth","authorization","files","jobs","notifications","observability","persistence","tenancy","webhooks"] },
];
```

Update `generator/profiles.json` to mirror same 7 entries (alphabetically sorted by id, features alphabetically sorted within each entry) and ensure JSON ↔ TS parity.

- [x] **Step 4: Run test to verify it passes**

Run: `bun test generator/tests/catalog.test.ts -v`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add generator/src/profiles.ts generator/profiles.json generator/tests/catalog.test.ts
git commit -m "feat(generator): add multi-tenant-core, integration-platform and deprecated multi-tenant"
```

### Task 2: Pure planner consolidation (planFeatureSet + planFromSelection)

**Files:**
- Modify: `generator/src/plan.ts`
- Modify: `generator/src/errors.ts` (if new error needed)
- Test: `generator/tests/catalog.test.ts` or new `generator/tests/plan.test.ts`

**Interfaces:**
- Consumes: `validateFeatureSet`, `getFeature`, `getProfile`, `buildProjectPlan`
- Produces: `planFeatureSet(features, profileId?) -> ProjectPlan`, `planFromSelection(opts) -> ProjectPlan`, `closeTransitive(ids) -> string[]`, `parseCsv(csv) -> string[]`

- [x] **Step 1: Write failing test for transitive closure and ordering**

```ts
test("planFeatureSet transitive closure includes persistence for audit", () => {
  const plan = planFeatureSet(["audit"]);
  expect(plan.features).toEqual(expect.arrayContaining(["audit","persistence"]));
  expect(plan.features).toEqual([...plan.features].sort()); // deterministic
});
test("planFromSelection --features ambiguity rejected", () => {
  expect(() => planFromSelection({ profile: "minimal", featuresCsv: "persistence" })).toThrow(/ambiguous/);
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `bun test generator/tests/catalog.test.ts -v`
Expected: FAIL — unknown function

- [x] **Step 3: Implement plan helpers**

```ts
// generator/src/plan.ts additions
import { GenerationError } from "./errors";
export function parseCsv(csv: string): string[] {
  return [...new Set(csv.split(",").map(s=>s.trim()).filter(Boolean))];
}
export function closeTransitive(ids: string[]): string[] {
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
export function planFeatureSet(features: readonly string[], profileId="custom"): ProjectPlan {
  const sorted = [...features].sort();
  const issues = validateFeatureSet(sorted);
  const unknown = issues.find(i=>i.kind==="unknown-feature");
  if (unknown) throw new UnknownFeatureError(unknown.feature);
  if (issues.length>0) throw new Error(`feature set invalid: ${issues.map(i=>i.message).join("; ")}`);
  const closed = closeTransitive(sorted).sort();
  // revalidate after closure
  const closedIssues = validateFeatureSet(closed);
  if (closedIssues.length>0) throw new Error(`closed set invalid: ${closedIssues.map(i=>i.message).join("; ")}`);
  return buildProjectPlan(profileId, closed);
}
export function planFromSelection(opts: {profile?:string; featuresCsv?:string; withCsv?:string}): ProjectPlan {
  if (opts.featuresCsv && (opts.profile || opts.withCsv)) throw new GenerationError("ambiguous: use either --profile or --features, not both (got featuresCsv with profile/with)");
  if (opts.withCsv && !opts.profile) throw new GenerationError("--with requires --profile");
  if (opts.featuresCsv) {
    const feats = parseCsv(opts.featuresCsv);
    const closed = closeTransitive(feats).sort();
    return planFeatureSet(closed, "custom");
  }
  if (opts.profile && opts.withCsv) {
    const base = getProfile(opts.profile);
    const extra = parseCsv(opts.withCsv);
    const merged = [...new Set([...base.features, ...extra])];
    const closed = closeTransitive(merged).sort();
    return planFeatureSet(closed, opts.profile);
  }
  return planProject(opts.profile!);
}
// refactor planProject to delegate
export function planProject(profileId: string): ProjectPlan {
  const validated = validateProfile(profileId);
  if ("errors" in validated) { /* existing error handling */ }
  return planFeatureSet(validated.features, profileId);
}
```

Ensure `buildProjectPlan` now sorts features input and produces deterministic keep*/remove*.

- [x] **Step 4: Run test to verify it passes**

Run: `bun test generator/tests/catalog.test.ts -v`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add generator/src/plan.ts generator/src/errors.ts
git commit -m "feat(generator): consolidate pure planner planFeatureSet/planFromSelection"
```

### Task 3: CLI extensions for create:project (--features, --with, --list-*)

**Files:**
- Modify: `generator/src/create-project.ts`
- Create: `generator/src/list-formatters.ts` (optional helper)
- Test: `generator/tests/create-project.test.ts`

**Interfaces:**
- Consumes: `planFromSelection`, `PROFILES`, `FEATURES`, `GenerationError`
- Produces: CLI with --features, --with, --list-profiles, --list-features, deprecation warning on stderr

- [x] **Step 1: Write failing test for new flags**

```ts
test("--list-profiles prints all profiles deterministically", async () => {
  const out = await runCli(["--list-profiles"]); // helper that spawns bun
  expect(out).toContain("multi-tenant-core");
  expect(out).toContain("integration-platform");
});
test("--features custom materializes correctly", async () => {
  const dir = mkdtempSync("/tmp/api-custom-");
  await runCli(["--features=persistence,auth","--out",dir]);
  expect(existsSync(`${dir}/modules/organizations`)).toBe(false); // tenancy not requested
});
test("deprecated multi-tenant emits warning", async () => {
  const {stderr} = await runCliCapture(["--profile=multi-tenant","--out", mkdtempSync("/tmp/x-")]);
  expect(stderr).toMatch(/deprecated/);
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `bun test generator/tests/create-project.test.ts -v`
Expected: FAIL

- [x] **Step 3: Implement CLI changes**

```ts
// generator/src/create-project.ts excerpt
const USAGE = `usage: bun generator/src/create-project.ts --profile <id> --out <dir> [--force] | --features <csv> --out <dir> [--force] | --profile <id> --with <csv> --out <dir> [--force]
       bun generator/src/create-project.ts --list-profiles [--json]
       bun generator/src/create-project.ts --list-features [--json]`;

function printProfiles(asJson:boolean) {
  if (asJson) { console.log(JSON.stringify(PROFILES, null, 2)); return; }
  for (const p of [...PROFILES].sort((a,b)=>a.id.localeCompare(b.id))) {
    const dep = p.deprecated ? " (deprecated)" : "";
    console.log(`${p.id.padEnd(22)} ${p.description} [${p.features.join(", ") || "(none)"}]${dep}`);
  }
}
function printFeatures(asJson:boolean) {
  if (asJson) { console.log(JSON.stringify(FEATURES, null, 2)); return; }
  for (const f of FEATURES) {
    console.log(`${f.id.padEnd(20)} ${f.description} requires:[${f.requires.join(",")||"-"}] excludedBy:[${f.excludedBy.join(",")||"-"}]`);
  }
}
// In main(): early dispatch for list flags
if (args.includes("--list-profiles")) { printProfiles(args.includes("--json")); process.exit(0); }
if (args.includes("--list-features")) { printFeatures(args.includes("--json")); process.exit(0); }

// Add parsing for --features and --with
let featuresCsv: string|undefined;
let withCsv: string|undefined;
...
else if (arg==="--features" || arg.startsWith("--features=")) { featuresCsv = arg==="--features" ? args[++index] : arg.slice("--features=".length); }
else if (arg==="--with" || arg.startsWith("--with=")) { withCsv = arg==="--with" ? args[++index] : arg.slice("--with=".length); }

// Plan resolution
let plan: ProjectPlan;
if (featuresCsv || withCsv) {
  plan = planFromSelection({ profile: profileId, featuresCsv, withCsv });
  // if withCsv, profileId must be present (planFromSelection validates)
  // deprecation check via getProfile if profileId present
  if (profileId) {
    try { const p = getProfile(profileId); if (p.deprecated) console.warn(`⚠ Profile "${p.id}" is deprecated: ${p.deprecatedReason}. Use one of: ${p.replacementProfiles?.join(", ")}`); } catch {}
  }
} else {
  plan = planProject(profileId!);
  const p = getProfile(profileId!);
  if (p.deprecated) console.warn(`⚠ Profile "${p.id}" is deprecated: ${p.deprecatedReason}. Use one of: ${p.replacementProfiles?.join(", ")}`);
}
```

Keep existing `--profile`/`--out`/`--force` handling; ambiguity validated inside `planFromSelection`.

- [x] **Step 4: Run test to verify it passes**

Run: `bun test generator/tests/create-project.test.ts -v`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add generator/src/create-project.ts generator/src/list-formatters.ts generator/tests/create-project.test.ts
git commit -m "feat(generator): support --features/--with and --list-* with deprecation warning"
```

### Task 4: Harden generator:validate (validateCatalog)

**Files:**
- Modify: `generator/src/validate.ts`
- Modify: `generator/src/cli-validate.ts`
- Test: `generator/tests/catalog.test.ts`

**Interfaces:**
- Consumes: `PROFILES`, `FEATURES`, `validateFeatureSet`
- Produces: `validateCatalog(): ValidationIssue[]` with 9 families, `cli-validate` supports --list-* and --json

- [x] **Step 1: Write failing test for catalog invalidations**

```ts
test("validateCatalog rejects unsorted features", () => {
  // mock PROFILES with unsorted features via helper that calls validateCatalog on synthetic data
  expect(validateCatalogFor([{id:"x", features:["auth","persistence"]}])).toContainEqual(expect.objectContaining({kind:"ordering-violation"}));
});
test("validateCatalog rejects platform incomplete", () => {
  expect(validateCatalogFor(missingObservabilityProfiles)).toContainEqual(expect.objectContaining({message: expect.stringContaining("platform")}));
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `bun test generator/tests/catalog.test.ts -v`
Expected: FAIL

- [x] **Step 3: Implement validateCatalog**

```ts
// generator/src/validate.ts additions
export type CatalogIssueKind = ValidationIssueKind | "duplicate-profile" | "ordering-violation" | "invalid-replacement" | "platform-incomplete" | "cycle";
export interface CatalogIssue extends ValidationIssue { kind: CatalogIssueKind; }

const DEFERRED = new Set(["dynamicRoles"]);

export function validateCatalog(): CatalogIssue[] {
  const issues: CatalogIssue[] = [];
  const ids = new Set<string>();
  for (const p of PROFILES) {
    if (ids.has(p.id)) issues.push({kind:"duplicate-profile", feature:p.id, message:`Duplicate profile id "${p.id}"`});
    ids.add(p.id);
  }
  // per-profile checks using validateFeatureSet plus ordering
  for (const p of PROFILES) {
    const sorted = [...p.features].sort();
    if (JSON.stringify(p.features) !== JSON.stringify(sorted)) {
      issues.push({kind:"ordering-violation", feature:p.id, message:`Profile "${p.id}" features not deterministically sorted; expected ${sorted.join(",")}`});
    }
    const featIssues = validateFeatureSet(p.features);
    for (const i of featIssues) issues.push(i as CatalogIssue);
    // deprecated checks
    if (p.deprecated) {
      if (!p.replacementProfiles || p.replacementProfiles.length===0) {
        issues.push({kind:"invalid-replacement", feature:p.id, message:`Deprecated profile "${p.id}" must list replacementProfiles`});
      } else {
        for (const r of p.replacementProfiles) {
          if (!ids.has(r)) issues.push({kind:"unknown-profile", feature:r, message:`Unknown replacement profile "${r}" for "${p.id}"`});
        }
      }
    } else if (p.replacementProfiles && p.replacementProfiles.length>0) {
      issues.push({kind:"invalid-replacement", feature:p.id, message:`Non-deprecated profile "${p.id}" must not list replacementProfiles`});
    }
  }
  // cycle detection
  const graph = new Map(FEATURES.map(f=>[f.id, f.requires]));
  const visiting = new Set<string>(), visited=new Set<string>();
  function dfs(node:string, stack:string[]) {
    if (visiting.has(node)) { issues.push({kind:"cycle", feature:node, message:`Cycle detected: ${[...stack, node].join(" -> ")}`}); return; }
    if (visited.has(node)) return;
    visiting.add(node);
    for (const dep of graph.get(node) ?? []) dfs(dep, [...stack, node]);
    visiting.delete(node); visited.add(node);
  }
  for (const f of FEATURES) dfs(f.id, []);
  // platform completeness
  const platform = PROFILES.find(p=>p.id==="platform");
  if (platform) {
    const allMinusDeferred = FEATURES.map(f=>f.id).filter(id=>!DEFERRED.has(id)).sort();
    const platSorted = [...platform.features].sort();
    if (JSON.stringify(platSorted) !== JSON.stringify(allMinusDeferred)) {
      issues.push({kind:"platform-incomplete", feature:"platform", message:`platform must equal all features except deferred ${[...DEFERRED]}; expected ${allMinusDeferred.join(",")} got ${platSorted.join(",")}`});
    }
  }
  return issues;
}
```

Update `cli-validate.ts` to:
- early handle `--list-profiles`/`--list-features` (reuse formatters),
- support `--json` output,
- otherwise call `validateCatalog()` and also `validateProfile(profileId)` if `--profile` given, print issues and exit 1 if any.

- [x] **Step 4: Run test to verify it passes**

Run: `bun test generator/tests/catalog.test.ts -v` and `bun run generator:validate`
Expected: PASS, no output means valid

- [x] **Step 5: Commit**

```bash
git add generator/src/validate.ts generator/src/cli-validate.ts generator/tests/catalog.test.ts
git commit -m "feat(generator): harden validate with catalog-wide invariants"
```

### Task 5: Docs and matrix verification

**Files:**
- Modify: `docs/architecture.md`
- Modify: `README.md`
- Test: manual matrix + existing tests

- [x] **Step 1: Update docs/architecture.md profiles table**

Add table rows for `multi-tenant-core` and `integration-platform`, mark `multi-tenant` as deprecated with replacement note, document `--features`/`--with`.

- [x] **Step 2: Update README generation section**

Document new profiles and custom composition examples.

- [x] **Step 3: Run full verification matrix**

Run:
```bash
bun run lint
bun run typecheck
bun test
bun run generator:validate
bun run generator:validate -- --list-profiles
bun run generator:validate -- --list-features
for p in minimal data-api authenticated multi-tenant-core integration-platform platform; do echo "=== $p ==="; bun run create:project -- --profile=$p --out=/tmp/api-$p --force; done
for p in minimal data-api authenticated multi-tenant-core integration-platform platform; do (cd /tmp/api-$p && bun install --frozen-lockfile && bun run typecheck && bun test) || echo "FAIL $p"; done
```

Expected: All lint/typecheck/test pass, each materialized project passes its own checks.

- [x] **Step 4: Commit docs**

```bash
git add docs/architecture.md README.md
git commit -m "docs: update profiles table and generation guide for granular profiles"
```
