## ADDED Requirements

### Requirement: Factory invariant preserved

Generated projects SHALL NOT acquire a runtime dependency on `api-starter` as a result of the update machinery. The updater remains generator tooling (`generator/src/*`) and SHALL NOT introduce an IoC container, config DSL, dynamic plugin runtime, or mandatory `api-starter` import into `apps/api`/`packages`/`modules`.

#### Scenario: Generated project remains standalone
- **WHEN** a project is inspected after `update --apply`
- **THEN** its `package.json` dependencies contain no `api-starter` runtime import and it boots without the starter checkout present
