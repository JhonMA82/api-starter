## Context

See proposal. This change depends on the manifest (schemaVersion 1, baselineHash, strategy) and materialize helper. The engine must not copy the repo blindly; it must reason file-by-file and support structured merges.

Constraints: domain←application←http preserved; updater must not contaminate API runtime; no secret logging; determinism and idempotency.

## Goals / Non-Goals

**Goals:** Materialize-compare-classify loop, doctor/diff/update with backup/rollback, safe file strategies, human+JSON output, deterministic/typed.

**Non-Goals:** Versioned migration registry/sequencing (next change), governance ADR, generated/extensions separation beyond strategy tagging, executing destructive DB migrations.

## Decisions

### Decision 1: Materialize to temp
- **Choice:** `materializeToTemp(plan): string` creates `fs.mkdtempSync(os.tmpdir()+"/api-starter-canonical-")`, calls shared `materializeProject`, returns path. Caller cleans up via `try/finally` and `rmSync`.
- **Rationale:** Enables diff/update to get byte-exact canonical output without polluting user's project; uses same planner so --features custom compositions are honored.
- **Alternative:** Diff against git history - rejected (no guarantee of feature-set fidelity).

### Decision 2: Classification table
- **Choice:** In `update-plan.ts`, for each path in union(baseline keys, current fs, canonical next):
  - if new in next && missing locally → `add`
  - if current==baseline && next!=baseline → `update-safe`
  - if next missing && current==baseline && locally exists → `remove-safe`
  - if current==next → `unchanged`
  - if current!=baseline && next==baseline → `customized-no-upstream-change` (keep)
  - if current!=baseline && next!=baseline && current!=next → `conflict`
- Plus `manual-migration` when file is birth in tenant-scoped migration needing data review.
- **Rationale:** Exactly spec §10 table; trivial to test deterministically.

### Decision 3: File strategies
- **Managed:** byte replace if update-safe, otherwise conflict.
- **Structured JSON:** parse and shallow-merge only managed keys. For `package.json`: manage `dependencies`/`devDependencies` keys that are `@consulting/*` or `drizzle-*` plus `workspaces`? Preserve user scripts/deps outside that set. For `tsconfig.json`, manage `compilerOptions.paths` for workspaces only. For `.env.example`, key-wise merge: add required by new features, remove only if previously managed and now unused and not customized.
- **Env:** never touch `.env`; only `.env.example`.
- **YAML/text:** Prefer real parser if available (js-yaml) else generated-region markers. Since adding a parser is a pin, start with region approach and document.

### Decision 4: Doctor / Diff / Update CLI shapes
- **doctor:** args `--project=path` (default `.`), `--json`. Checks: manifest missing/invalid, schema unsupported, unknown starter version/feature/conflict, missing managed file, hash mismatch (modified), stale appliedUpdates, composition residual (prune list present), git dirty (`git status --porcelain` non-empty → warning not error). Output: array of issues `{code, path, severity, message, suggestion}`. Exit 0 if only warnings/extra untracked files; non-zero on errors.
- **diff:** args `--project`, `--to=<version>` (target manifests version not used to checkout but to materialize? For now materializes with current generator's catalog; --to validated as SemVer but not yet network-fetched). Read-only, prints classification tables. Exit 1 on any conflict.
- **update:** args `--project`, `--to`, `--apply` (without apply = dry-run), no global --force. Steps: build plan via diff engine → if conflicts and not explicit per-file --include → abort; backup to `.api-starter/backups/<iso>/`; apply `add`/`update-safe`/`remove-safe` deterministically sorted; run `bun x tsc --noEmit` and `bun test` inside project (with timeout); on failure restore from backup and do not bump manifest; on success update `managedFiles` baselineHashes, `starter.version` to target, push to `appliedUpdates`, bump `updatedAt`, write atomically.

### Decision 5: Backup and rollback
- **Choice:** Before writing, `copyFileSync` current file to backup dir for each `update-safe`/`remove-safe`/`add` target. On post-validation failure, restore each backup and delete adds.
- **Rationale:** Reversible without git.

### Decision 6: Validation hooks
- **Choice:** Post-update runs `bun x tsc --noEmit` (quick) and optionally `bun test --runInBand` only if project has tests. Controlled by manifest's `postUpdateValidations` field (future). For now always typecheck, test if in profile.
- **Alternative:** No validations - rejected (spec requires them).

## Risks / Trade-offs

- **[Risk] Post-validation may be slow** → Mitigation: doctor/diff separate cheap checks; update validations run only on apply.
- **[Risk] Structured merge incomplete for complex YAML** → Mitigation: fall back to generated-region marker rather than fragile regex.
- **[Risk] Backup directory clutter** → Mitigation: under `.api-starter/backups/` which can be gitignored and pruned manually.

## Migration Plan

- Steps: create hashing/materialize/file-strategies/update-plan, then doctor/diff/update CLIs, add package scripts, write tests, run lint/typecheck/test.
- Rollback: remove new scripts; no runtime residue.

## Open Questions

- None.
