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
