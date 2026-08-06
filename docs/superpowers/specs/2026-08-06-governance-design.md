---
comet_change: migrations-governance
role: technical-design
canonical_spec: openspec
archived-with: 2026-08-05-migrations-governance
status: final
---

# Technical Design: Governance and Update Registry

## Context

See proposal. Depends on doctor/diff/update engine and manifest. Must not introduce framework. Constraints: no IoC, no premature packages, domain←application←http preserved.

OpenSpec handoff: docs/openspec/changes/migrations-governance/.comet/handoff/design-context.md

## Goals / Non-Goals

Goals: Sequential SemVer registry, DB migration handling, ADR, template, guardrails.
Non-Goals: New product features.

## Technical Approach

### 1. Registry
`generator/updates/registry.ts` with STARTER_VERSION, Update interface, UPDATES sorted, resolveUpdatePath with contiguous chain validation, idempotent skip, SemVer compare.

### 2. DB handling
Update plan may add migrations/* and journal patch, detect duplicate, manual-migration for tenancy.

### 3. ADR and template
ADR 0013 with tiers, compatibility, ownership, update strategy, prohibitions, admission, complexity budget. Template with mandatory questions.

### 4. Guardrails
Extend boundary.test.ts and generator/tests/architecture.test.ts to check domain/application/packages layering, residual, etc.

## Testing

- Sequential path, gap rejection, idempotency, DB collision, layering.

## Risks

- ADR number collision → check existing.
- Registry growth → reversible flag.

## Migration

Additive; delete registry and ADR to rollback.

## Open Questions

- None.
