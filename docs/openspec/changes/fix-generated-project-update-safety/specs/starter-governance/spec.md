## ADDED Requirements

### Requirement: Version truth aligned across docs, Docker, and fixtures

Documentation, Docker examples, fixtures, and registry SHALL be synchronized after any version bump so that `docs/updating-generated-projects.md` describes only implemented behaviour, lists genuine limitations, and states the real `--to` source, the set of structured merges truly supported, and the exact validations executed.

#### Scenario: Docs reflect reality post-fix
- **WHEN** `docs/updating-generated-projects.md` is read after the change
- **THEN** it does NOT claim sequential registry execution unless it is implemented, does NOT claim generic structured merges beyond `package.json` / `.env.example`, lists `typecheck/lint/test` exactly as run, and has a Limitations section
