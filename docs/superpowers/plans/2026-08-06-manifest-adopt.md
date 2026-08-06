---
change: versioned-manifest-adopt
design-doc: docs/superpowers/specs/2026-08-06-manifest-adopt-design.md
base-ref: 8e63cee0b116b0c9a7c48b41ead2a09960420197
---

# Versioned Manifest and Adopt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Introduce .api-starter/manifest.json with atomic hashing and adopt legacy projects.

**Architecture:** manifest.ts + hashing.ts + materialize.ts shared, create-project emits manifest, add:feature patches, adopt compares baseline via temp materialize.

**Tech Stack:** Bun 1.3.14, TypeScript 7.0.2, node:crypto, node:fs

## Global Constraints

- packageManager: bun@1.3.14 exact
- No Hono/Bun in generator runtime
- Atomic writes, stable ordering, SHA256

---
### Task 1: Manifest infrastructure

**Files:**
- Create: generator/src/hashing.ts
- Create: generator/src/manifest.ts
- Create: generator/src/materialize.ts

- [x] Step 1: Write failing test for hashing and manifest validation
- [x] Step 2: Implement hashing.ts SHA256
- [x] Step 3: Implement manifest.ts strict schema v1
- [x] Step 4: Implement materialize.ts shared helper

### Task 2: Generation integration

**Files:**
- Modify: generator/src/create-project.ts
- Modify: generator/src/add-feature.ts

- [x] Step 1: Wire create-project to emit manifest atomically
- [x] Step 2: Update add:feature to patch manifest
- [x] Step 3: Ensure managedFiles excludes secrets/.env

### Task 3: Adopt

**Files:**
- Create: generator/src/adopt-project.ts

- [x] Step 1: Implement adopt CLI parsing GENERATED.md
- [x] Step 2: Report divergences before write
- [x] Step 3: Preserve legacy read path with warning

### Task 4: Tests and docs

**Files:**
- Modify: generator/tests/manifest.test.ts
- Modify: docs/architecture.md

- [x] Step 1: Add tests for manifest, hashing, adopt
- [x] Step 2: Update docs
- [x] Step 3: Run lint/typecheck/test and manifest generation for each profile
