# Brainstorm Summary

- Change: doctor-diff-update-engine
- Date: 2026-08-06

## Confirmed Technical Approach

- Materialize to temp via shared planner, classify via update-plan table (add/update-safe/remove-safe/unchanged/customized/conflict/manual-migration)
- File strategies: managed replace, structured JSON key-wise merge, env key-wise, scaffold never auto-update, ignored
- Doctor checks 11 categories, diff read-only with --json, update with --apply, backup/rollback, post-validations, idempotent

## Key Trade-offs and Risks

- Structured merge may be incomplete for YAML → fallback to generated-region
- Backup clutter under .api-starter/backups

## Testing Strategy

- Clean project, modified, missing, extra untracked, corrupt manifest, diff without writes, JSON validity, exit codes, update intact/preserved/conflict/add/remove-safe/merge-package.json/rollback/idempotency/custom

## Spec Patches

- None
