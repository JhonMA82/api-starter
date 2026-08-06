# Comet Design Handoff

- Change: migrations-governance
- Phase: design
- Mode: compact
- Context hash: 35b27313a1adc5273d9aca9b53ec63527a3c1a947f9d0ab9de7f0a3cac65494c

Generated-by: comet-handoff.sh

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## docs/openspec/changes/migrations-governance/proposal.md

- Source: docs/openspec/changes/migrations-governance/proposal.md
- Lines: 1-28
- SHA256: 810a6add9549422f626b917000aa77d9ca68df9ce8d783cf006cc48d9e77568f

```md
## Why

Without an explicit sequential update registry and a gatekeeping policy, `api-starter` risks defeating its own premise: becoming an internal framework that absorbs every product need, accumulating coupling and making future updates unsafe. A governed evolution needs versioned sequential migrations and architectural guardrails that classify what belongs in core vs. feature vs. recipe vs. product domain.

## What Changes

- Create `generator/updates/registry.ts` and `generator/updates/<from>-to-<to>.ts` fixtures (e.g., `0.10.1-to-0.10.2.ts`) where each update declares `id`, `from`, `to`, `appliesTo` features, `plan(context)` returning operations (not writing directly), `requiresManual`, `postValidations`, `reversible`, and breaking change docs.
- Enforce sequential SemVer execution: e.g., `0.1.0 → 0.2.0 → 0.3.0 → 0.4.0` must run in order, reject incomplete paths, never skip migrations, record each applied update in manifest `appliedUpdates`, support idempotence, and distinguish patch/minor/major correctly.
- Add DB migration handling: update-side may add journal entries deterministically, detect name/index collisions, require manual plan for tenancy/data changes, distinguish code migration vs data migration, require separate `db:migrate` execution, and document backup/rollback for destructive changes. No destructive DB migration runs automatically via `generator:update`.
- Add `docs/decisions/ADR-XXXX-starter-evolution-and-update-policy.md` (next available ADR number) establishing: what api-starter is/is not, profile/feature/recipe/domain policy, compatibility/versioning/deprecation, ownership of generated code, update strategy, prohibition of mandatory private runtime framework, admission and removal criteria.
- Add `docs/feature-proposal-template.md` with questions: transversal problem, real projects needing it, why not a recipe, dependencies, how pruned, how updated, how deprecated, maintenance cost, simpler alternatives discarded.
- Expand architectural boundary tests/scripts to verify: `domain` never imports Hono/Bun/DB/IO, `application` never imports Hono, `packages/*` don't acquire product module deps, unselected features leave no residue (modules, imports, migrations, env vars), optional feature not becoming implicit core dep, examples/integrations not in workspaces/runtime absent explicit selection, no runtime dependency toward generator, generated project can diverge without private starter package.
- Optionally separate generated vs extension seams conceptually (e.g., `apps/api/src/generated/` vs `extensions/`) via docs and header markers without introducing filesystem magic or reflection scanning.

## Capabilities

### New Capabilities
- `generator-updates`: sequential, versioned update registry with SemVer, feature-scoped applicability, recorded history and reversible flag.
- `starter-governance`: ADR policy and feature-proposal template plus classification (Core / Feature optional / Recipe / Product domain) enforcement.
- `architecture-guardrails`: automated boundary checks for layering, pruning completeness and no private-runtime dependency.

### Modified Capabilities
<!-- None -->

## Impact

- Affects: `generator/updates/*`, `generator/src/manifest.ts` (appliedUpdates integration), `generator/src/update-project.ts` (sequential loop), `docs/decisions/*`, `docs/feature-proposal-template.md`, `docs/architecture.md`, `docs/updating-generated-projects.md`, `generator/tests/*`, `apps/api/tests/boundary.test.ts` or new guard scripts.
- No runtime framework added; tooling stays in generator.

```

## docs/openspec/changes/migrations-governance/design.md

- Source: docs/openspec/changes/migrations-governance/design.md
- Lines: 1-52
- SHA256: 3297e665f35511eef82fe2e8da10e33334873b72b01f585afbd32af02e95f412

```md
## Context

See proposal. Prior three changes land profiles, manifest, and doctor/diff/update engine. This final change adds the sequential registry layer and the governance that prevents framework-creature growth.

Constraints: No IoC/service locator/plugin DSL; no premature published packages; keep `domain←application←http`; updater must not write arbitrarily outside planned operations.

## Goals / Non-Goals

**Goals:** Sequential SemVer updates, DB migration handling without auto-destruction, ADR policy, proposal template, and boundary guardrails.

**Non-Goals:** Implementing a specific product feature (e.g., new auth provider) — this change is meta.

## Decisions

### Decision 1: Registry shape
- **Choice:** `generator/updates/registry.ts` exports `STARTER_VERSION = "0.10.1"` (from package.json) and `UPDATES: readonly Update[]` sorted by SemVer `from`. Each `Update` type: `{ id: "0.10.1-to-0.11.0", from, to, appliesTo?: string[], plan(context:{ manifest, projectDir, canonicalNextDir }): PlannedOperation[], requiresManual?: string[], postValidations?: string[], reversible: boolean, breakingNotes?: string }`.
- **Rationale:** Pure plan functions prevent each migration from arbitrarily writing the project; the update engine orchestrates.
- **Alternative:** Each update runs fs writes itself - rejected (violates spec §13).

### Decision 2: Sequencing
- **Choice:** `resolveUpdatePath(fromVersion, toVersion): Update[]` does SemVer compare, walks `UPDATES` in order, requires `from` chain to be contiguous; throws if gap or unknown versions. Applied updates already in manifest are skipped for idempotence but still validated for contiguity. `starter.version` SemVer diff classifies patch vs minor vs major for docs but not for execution (all run).
- **Rationale:** Deterministic sequential execution per spec §14.

### Decision 3: DB migration handling
- **Choice:** Update's `plan` may include `managed-file-add` for `migrations/<name>.sql` and journal patch; engine adds files but never runs `db:migrate`. It checks for duplicate journal entry names and index collisions via `journal.json` parsing. Tenancy or data-shape changes produce `manual-migration` entries with docs pointer. Runbook is referenced in ADR.
- **Rationale:** Separates code migration from data migration; prevents silent destructive DB changes.

### Decision 4: ADR and template
- **Choice:** ADR file `docs/decisions/ADR-0008-starter-evolution-and-update-policy.md` (or next number) with sections: Context, Decision (what is/is not api-starter), Policy tiers (core/feature/recipe/domain), Compatibility & versioning, Ownership, Update strategy, Prohibitions, Admission/removal gates, Complexity budget. Template `docs/feature-proposal-template.md` with mandatory questions list from spec §18.1.
- **Rationale:** Governance must be documented and versioned.

### Decision 5: Guardrails
- **Choice:** Extend `apps/api/tests/boundary.test.ts` (existing) to also assert generator layering: new `generator/tests/architecture.test.ts` or shell script `scripts/check-boundaries.ts` that greps for forbidden imports (`from "hono" in modules/*/domain`, etc.), checks `computeKeepList`/`computeRemoveList` leaves no residual, and verifies `apps/api/package.json` does not depend on generator.
- **Rationale:** Keeps checks in test suite so CI fails on layering violation.

### Decision 6: Generated vs extension seam (optional)
- **Choice:** Not physically splitting `apps/api/src` yet, but adding header comment `// generated by @consulting/generator — do not edit manually` to managed `app.ts`/`routes.ts` and documenting extension seam as `apps/api/src/extensions/` + `app.ts` minimal wiring, with explicit typed composition (no reflection).
- **Rationale:** Reduces future conflicts without forcing a large move.

## Risks / Trade-offs

- **[Risk] ADR number collision** → Mitigation: list existing ADRs and pick next free; `comet state check` helps.
- **[Risk] Update registry grows unchecked** → Mitigation: each entry must have reversible flag and breakingNotes; governance gates admission.

## Migration Plan

- Steps: create registry, one example update file, wire sequencing into `update-project.ts`, add ADR/template, extend boundary tests, update docs.
- Rollback: delete registry entries and ADR; no code side-effects.

## Open Questions

- None.

```

## docs/openspec/changes/migrations-governance/tasks.md

- Source: docs/openspec/changes/migrations-governance/tasks.md
- Lines: 1-23
- SHA256: 09b5771cfbcecc93eb8851295876383d419289700c326a3c806c2cbfa4c697ed

```md
## 1. Update registry and sequencing

- [x] 1.1 Create `generator/updates/registry.ts` with `STARTER_VERSION`, `Update` interface, `UPDATES[]` sorted by SemVer, and `resolveUpdatePath(from,to)` with contiguous chain validation and idempotent skip of already-applied ids
- [x] 1.2 Add example update file `generator/updates/0.10.1-to-0.11.0.ts` (or next version) with `id, from, to, appliesTo, plan(context), reversible, breakingNotes` exemplar
- [x] 1.3 Wire registry into `generator/src/update-project.ts` sequencing loop and manifest `appliedUpdates` recording, ensuring never skipped and failure does not mark as applied

## 2. DB migration handling

- [x] 2.1 Implement deterministic journal patching and collision detection (duplicate name/index) inside update engine
- [x] 2.2 Ensure `generator:update` never auto-runs `db:migrate`; produce manual-migration entries for tenancy/data-shape changes and reference backup/rollback runbook

## 3. ADR and template

- [x] 3.1 Write `docs/decisions/ADR-0008-starter-evolution-and-update-policy.md` (or next free) covering: what is/is not api-starter, tiers, compatibility/versioning/deprecation, ownership, update strategy, private-runtime prohibition, admission/removal criteria, complexity budget
- [x] 3.2 Create `docs/feature-proposal-template.md` with mandatory questions list per spec §18.1
- [x] 3.3 Update `docs/architecture.md` and `docs/updating-generated-projects.md` to reference registry and governance

## 4. Guardrails and verification

- [x] 4.1 Extend `apps/api/tests/boundary.test.ts` or add `generator/tests/architecture.test.ts` to assert domain/application/packages layering invariants and residual-free pruning
- [x] 4.2 Add test/check that `apps/api/package.json` and imports never reference `generator` and that generated projects diverge without private package
- [x] 4.3 Add tests for sequential update path: contiguous success, gap rejection, idempotency, DB collision detection
- [x] 4.4 Run full matrix: `bun run lint`, `bun run typecheck`, `bun test`, `bun run generator:validate` and materialize each new profile to verify pruning and guardrails pass

```

## docs/openspec/changes/migrations-governance/specs/architecture-guardrails/spec.md

- Source: docs/openspec/changes/migrations-governance/specs/architecture-guardrails/spec.md
- Lines: 1-25
- SHA256: 0957ed3eaf05c8ee6488ca026ba047351c29c31dd4ce464225e4f154be0b69ee

```md
## Purpose

Enforces layering and pruning invariants so the generator stays a code factory without hidden coupling or residual artifacts.

## ADDED Requirements

### Requirement: Layering invariants enforced

Automated checks SHALL verify: `domain` imports no Hono, Bun, DB or IO; `application` imports no Hono; `packages/*` do not import product modules; features not selected leave no modules/imports/migrations/env residuals; optional feature does not become implicit core dep; examples/integrations not in workspaces/runtime absent explicit selection; no runtime dependency toward generator; generated project can diverge without private starter package.

#### Scenario: Domain imports Hono is caught

- **WHEN** a file under any `modules/*/src/domain/` adds `import { Context } from "hono"`
- **THEN** the boundary test or script fails with message mentioning forbidden Hono import in domain

#### Scenario: Unselected feature leaves residual

- **WHEN** a project generated with `minimal` still contains `modules/organizations` directory
- **THEN** `computeKeepList`/`computeRemoveList` tests and/or doctor residual check fail

#### Scenario: Runtime does not depend on generator

- **WHEN** inspecting `apps/api/package.json` dependencies of a generated `platform` project
- **THEN** no dependency name contains `generator` and no import in `apps/api/src/**` references `generator/`


```

## docs/openspec/changes/migrations-governance/specs/generator-updates/spec.md

- Source: docs/openspec/changes/migrations-governance/specs/generator-updates/spec.md
- Lines: 1-38
- SHA256: 491abb0c2f67fa891fd0e73338111a83af6f87ada1fddbfe5a3020f12dd510b0

```md
## Purpose

Ensures updates are applied in explicit sequential SemVer order with recorded history, feature applicability and no silent skips.

## ADDED Requirements

### Requirement: Sequential versioned updates

The updater SHALL resolve the path `from → to` as an ordered contiguous chain of registry entries (e.g., `0.10.1→0.10.2→0.11.0`). It SHALL reject incomplete paths, never skip a migration, record each successfully applied `id` in manifest `appliedUpdates`, and support idempotent re-run (already-applied entries produce no-ops). It SHALL use SemVer to distinguish patch/minor/major but MUST NOT mark an update as completed if its post-validations failed.

#### Scenario: Contiguous path succeeds

- **WHEN** a project at `0.10.1` updates `--to=0.10.3` where registry has `0.10.1→0.10.2` and `0.10.2→0.10.3`
- **THEN** both migrations run in order and `appliedUpdates` ends with both ids

#### Scenario: Gap in registry is rejected

- **WHEN** registry lacks `0.10.2→0.10.3` but user requests `0.10.1→0.10.3`
- **THEN** update exits non-zero reporting "no update path from 0.10.1 to 0.10.3: missing 0.10.2→0.10.3"

#### Scenario: Re-running applied update is idempotent and skips

- **WHEN** `generator:update -- --to=0.10.2 --apply` is run twice after first success
- **THEN** the second run reports no changes and does not duplicate entries in `appliedUpdates`

### Requirement: DB migration handling is non-destructive

The updater SHALL incorporate new migration files and journal patches deterministically, detect name/index collisions, generate a `manual-migration` entry for tenancy/data changes, never execute destructive DB migrations automatically, require explicit `bun run db:migrate`, and point to backup/rollback docs for potentially destructive changes.

#### Scenario: Duplicate journal name detected

- **WHEN** canonical journal contains a migration name already present locally with different content hash
- **THEN** doctor/diff report a collision error and update aborts before writing

#### Scenario: DB migration not auto-executed

- **WHEN** an update adds `migrations/00012_...sql`
- **THEN** `generator:update --apply` adds the file and patches `migrations/meta/_journal.json` but does not run `db:migrate`; docs state user must run it separately

```

## docs/openspec/changes/migrations-governance/specs/starter-governance/spec.md

- Source: docs/openspec/changes/migrations-governance/specs/starter-governance/spec.md
- Lines: 1-33
- SHA256: 58b48de84553e244d177763536f560c5248b4ae06067a3b7d823243656d3eef4

```md
## Purpose

Prevents the starter from becoming an internal framework by requiring explicit classification and an admission gate for every new capability.

## ADDED Requirements

### Requirement: Classification of every incorporation

Every new proposal SHALL be classified into one of: Core (universal small: errors/contracts/config/logging/security/health/tooling), Feature optional (transversal prunable with explicit deps), Recipe/integration example (provider wiring, frontend example, deploy config — lives under `integrations/`/`examples/`/recipe docs), or Product domain (orders/inventory/appointments/billing — never enters starter). Recipes SHALL NOT be part of runtime by default.

#### Scenario: Feature vs recipe decision

- **WHEN** a proposal for "Stripe webhook adapter" is submitted
- **THEN** the ADR policy routes it to Recipe (specific provider wiring) rather than Core/Feature

### Requirement: Admission gate for new features

A feature SHALL NOT be added to the catalog unless all gates pass: transversal+reusable, second real case demonstrated, physically prunable, explicit contracts/deps, no inverse imports to product modules, unit/integration/generator tests included, update/migration included, docs/env/operation included, maintenance owner or removal criteria, no general abstraction created solely for it.

#### Scenario: Incomplete proposal blocked

- **WHEN** a feature proposal lacks update/migration handling
- **THEN** review checklists reject it per `docs/feature-proposal-template.md` requiring that question

### Requirement: ADR and template exist

The repository SHALL contain `docs/decisions/ADR-XXXX-starter-evolution-and-update-policy.md` establishing policy tiers and `docs/feature-proposal-template.md` asking the mandatory questions (problem, real projects needing it, why not recipe, dependencies, pruning, update, deprecation, cost, simpler alternatives). Versioning and deprecation policy SHALL be documented.

#### Scenario: Docs presence verified

- **WHEN** `ls docs/decisions/ADR-*starter-evolution* docs/feature-proposal-template.md` is run after the change
- **THEN** both files exist and pass `biome check` not needed but are markdown with required sections


```
