---
comet_change: doctor-diff-update-engine
role: technical-design
canonical_spec: openspec
---

# Technical Design: Doctor, Diff, Update Engine

## Context

See proposal. Depends on manifest and materialize. Must not copy repo blindly; must reason file-by-file and support structured merges. Constraints: domain←application←http preserved; no secret logging; determinism.

OpenSpec handoff: docs/openspec/changes/doctor-diff-update-engine/.comet/handoff/design-context.md

## Goals / Non-Goals

Goals: Materialize-compare-classify, doctor/diff/update with backup/rollback, safe file strategies, human+JSON.
Non-Goals: Migration registry/sequencing (next change), governance ADR.

## Technical Approach

### 1. Materialize to temp
`materializeToTemp(plan)` creates mkdtemp, calls materializeProject, returns path. Caller cleans up. Uses same planner so --features custom honored.

### 2. Classification
`update-plan.ts` for each path in union(baseline keys, current fs, canonical next): add, update-safe, remove-safe, unchanged, customized-no-upstream-change, conflict, manual-migration. Deterministically sorted.

### 3. File strategies
Managed: byte replace if update-safe else conflict. Structured JSON: shallow-merge only managed keys (package.json @consulting/*, drizzle-*, .env.example key-wise). Env: never .env. YAML: generated-region fallback.

### 4. CLI shapes
doctor: --project (default .), --json, checks manifest missing/invalid, schema, unknown version/feature, missing/modified, stale hashes, unapplied migrations, composition mismatches, residual, git dirty warning. diff: --project, --to, read-only, materialize target, classify, explain why conflict, exit 1 on conflict, --json, no network. update: --project, --to, --apply (dry-run without), no global --force, abort on conflicts, backup to .api-starter/backups/<ts>/, deterministic apply, post-validations (typecheck/test), rollback on failure, manifest bump only on success, idempotent.

### 5. Backup and rollback
Before writing, copyFileSync current to backup dir for each update-safe/remove-safe/add. On failure restore.

### 6. Validation hooks
Post-update runs `bun x tsc --noEmit` and `bun test` (if applicable). Controlled by manifest field.

## Testing

- Clean, modified, missing, extra untracked, corrupt, diff without writes, JSON validity, exit codes, update intact/preserved/conflict/add/remove-safe/merge/rollback/idempotency/custom

## Risks

- Post-validation slow → doctor/diff cheap, update only on apply
- YAML incomplete → fallback to region

## Migration

Additive; remove new scripts no runtime residue.

## Open Questions

- None.
