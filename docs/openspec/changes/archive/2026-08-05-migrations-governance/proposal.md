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
