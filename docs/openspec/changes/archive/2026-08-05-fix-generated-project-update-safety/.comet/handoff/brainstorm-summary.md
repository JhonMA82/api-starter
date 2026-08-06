# Brainstorm Summary

- Change: fix-generated-project-update-safety
- Date: 2026-08-06

## Confirmed Technical Approach

Checkout-local canonical version via import.meta.url + git root fallback is single truth; --to optional-and-must-match validated before materialization; diff/update invoke resolveUpdatePath and surface registry metadata, block incomplete/downgrade/manual, execute steps ordered with deduped appliedUpdates; structured dispatch via applyFileOperation with failing-closed mergePackageJson and manual conflict for unsupported structured files; adopt stores canonical baselineHash with real getFileStrategy and rejects unmaterializable baselines; allow-list post-validations (typecheck/lint/test + registry extras) with 30s timeout and rollback; STARTER_VERSION derived from canonical + sync test; DB migrations → manual-migration per Route B; docs honesty rewrite.

## Key Trade-offs and Risks

- Strict --to may break scripts using stale manifest version → migrated via error hint.
- Adopt limited to canonical baseline without snapshots → documented limitation, fixtures later.
- Narrow structured support → intentional conflict rather than silent overwrite.
- Validation timeout 30s → configurable, skipped when script absent.
- Atomic backup cost → limited to safeOps, deterministic.

## Testing Strategy

Layered: unit version-truth, registry-integration, file-strategies, adopt, post-validations, version-sync; plus E2E temp-dir full cycle (personalize → doctor → diff → apply → idempotence → forced validation failure → rollback) and edge matrix (fictitious --to, downgrade, missing path, manual block, .env untouched, invalid JSON, copy-fail rollback, subdirectory, JSON stability). Tests run via bun test, no real project mutation, hashes compared, no network.

## Spec Patches

None – delta specs already capture new requirements; design only refines implementation.
