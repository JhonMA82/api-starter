# starter-governance Specification

## Purpose
Prevents the starter from becoming an internal framework by requiring explicit classification and an admission gate for every new capability.
## Requirements
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

### Requirement: Version truth aligned across docs, Docker, and fixtures

Documentation, Docker examples, fixtures, and registry SHALL be synchronized after any version bump so that `docs/updating-generated-projects.md` describes only implemented behaviour, lists genuine limitations, and states the real `--to` source, the set of structured merges truly supported, and the exact validations executed.

#### Scenario: Docs reflect reality post-fix
- **WHEN** `docs/updating-generated-projects.md` is read after the change
- **THEN** it does NOT claim sequential registry execution unless it is implemented, does NOT claim generic structured merges beyond `package.json` / `.env.example`, lists `typecheck/lint/test` exactly as run, and has a Limitations section

