# architecture-guardrails Specification

## Purpose
Enforces layering and pruning invariants so the generator stays a code factory without hidden coupling or residual artifacts.
## Requirements
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

### Requirement: Factory invariant preserved

Generated projects SHALL NOT acquire a runtime dependency on `api-starter` as a result of the update machinery. The updater remains generator tooling (`generator/src/*`) and SHALL NOT introduce an IoC container, config DSL, dynamic plugin runtime, or mandatory `api-starter` import into `apps/api`/`packages`/`modules`.

#### Scenario: Generated project remains standalone
- **WHEN** a project is inspected after `update --apply`
- **THEN** its `package.json` dependencies contain no `api-starter` runtime import and it boots without the starter checkout present

