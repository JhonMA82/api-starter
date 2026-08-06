## 1. Engine foundations

- [ ] 1.1 Implement `generator/src/hashing.ts` SHA-256 helpers and `generator/src/materialize.ts` `materializeToTemp` sharing logic with `create-project.ts` (if not already landed)
- [ ] 1.2 Implement `generator/src/file-strategies.ts` with strategies `managed`/`structured`/`scaffold`/`generated-region`/`ignored`; add JSON key-wise merge for `package.json`/`tsconfig.json` and env-key merge for `.env.example` (never `.env`)
- [ ] 1.3 Implement `generator/src/update-plan.ts` with classification table (add/update-safe/remove-safe/unchanged/customized-no-upstream-change/conflict/manual-migration) deterministically sorted

## 2. Doctor and Diff

- [ ] 2.1 Implement `generator/src/project-doctor.ts` (`generator:doctor`) with all checks listed in proposal, human + `--json` output, correct exit codes and git-dirty warning
- [ ] 2.2 Implement `generator/src/diff-project.ts` (`generator:diff`) read-only: materialize target, build plan via `update-plan.ts`, explain reasons, `--json`, non-zero on conflict/invalid, no writes verification

## 3. Update with safety

- [ ] 3.1 Implement `generator/src/update-project.ts` (`generator:update`) dry-run vs `--apply`, conflict abort (no global --force), backup under `.api-starter/backups/<ts>/`, deterministic apply
- [ ] 3.2 Add post-validation hooks (typecheck, tests) with automatic rollback on failure and manifest bump only on full success
- [ ] 3.3 Ensure idempotency: second apply after success reports unchanged and performs no writes

## 4. Tests and docs

- [ ] 4.1 Tests: clean project, modified managed file, missing file, extra untracked advisory, corrupt manifest, diff without writes, JSON validity, exit codes, update intact/preserved/conflict/add/remove-safe/merge-package.json/env handling/rollback/idempotency/custom-based project
- [ ] 4.2 Docs: `docs/updating-generated-projects.md` intro section and `docs/architecture.md` update strategy paragraph
- [ ] 4.3 Run `bun run lint/typecheck/test` and diff/update dry-run fixtures with real customizations
