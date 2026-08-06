---
change: migrations-governance
design-doc: docs/superpowers/specs/2026-08-06-governance-design.md
base-ref: 9bdeceeb289207529119c11a2f88c5a0b4ffc0a8
archived-with: 2026-08-05-migrations-governance
---

# Governance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development

**Goal:** Registry, ADR, template, guardrails

**Architecture:** registry, DB handling, ADR, template, boundary checks

**Tech Stack:** Bun, TypeScript

## Global Constraints

- No Hono/Bun in generator
- SemVer sequential, no destructive DB

---
### Task 1: Registry

**Files:**
- Create: generator/updates/registry.ts
- Create: generator/updates/0.10.1-to-0.11.0.ts

- [x] Step 1: Implement registry
- [x] Step 2: Add example update

### Task 2: Governance docs

**Files:**
- Create: docs/decisions/0013-starter-evolution-and-update-policy.md
- Create: docs/feature-proposal-template.md
- Create: docs/updating-generated-projects.md

- [x] Step 1: Write ADR
- [x] Step 2: Create template
- [x] Step 3: Update docs

### Task 3: Guardrails

**Files:**
- Modify: apps/api/tests/boundary.test.ts
- Modify: generator/tests/architecture.test.ts

- [x] Step 1: Extend boundary tests
- [x] Step 2: Add architecture checks
