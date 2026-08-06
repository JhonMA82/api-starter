---
change: doctor-diff-update-engine
design-doc: docs/superpowers/specs/2026-08-06-doctor-diff-update-design.md
base-ref: 1ce8cf117a18e698190c30f7c8d70ff44895c863
archived-with: 2026-08-05-doctor-diff-update-engine
---

# Doctor Diff Update Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development

**Goal:** Implement doctor/diff/update with materialize-compare-classify and safe strategies

**Architecture:** materializeToTemp, file-strategies, update-plan, doctor/diff/update CLIs

**Tech Stack:** Bun, TypeScript, node:crypto, node:fs

## Global Constraints

- No Hono/Bun in generator
- Atomic manifest, deterministic, no destructive --force

---
### Task 1: Engine foundations

**Files:**
- Create: generator/src/file-strategies.ts
- Create: generator/src/update-plan.ts

- [x] Step 1: Implement file-strategies
- [x] Step 2: Implement update-plan classification

### Task 2: Doctor and Diff

**Files:**
- Create: generator/src/project-doctor.ts
- Create: generator/src/diff-project.ts

- [x] Step 1: Implement doctor
- [x] Step 2: Implement diff

### Task 3: Update with safety

**Files:**
- Create: generator/src/update-project.ts

- [x] Step 1: Implement update dry-run vs --apply, backup, deterministic apply
- [x] Step 2: Add post-validation and rollback

### Task 4: Tests and docs

**Files:**
- Modify: generator/tests/doctor.test.ts
- Modify: docs/updating-generated-projects.md

- [x] Step 1: Add tests for doctor/diff/update
- [x] Step 2: Update docs
