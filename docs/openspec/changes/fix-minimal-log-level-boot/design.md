# Design: fix-minimal-log-level-boot

## Solution

Single, focused fix with two touch points:

### 1. `packages/config/src/env.ts`

Change `LOG_LEVEL` from required enum to enum with default:

```ts
// before
LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]),

// after
LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
```

Rationale: every other base env var already has a default; `info` is the value used in `.env.example`, `.env.test.example`, and all tests. This makes `parseEnv({})` succeed for `LOG_LEVEL`, so a minimal generated project can boot immediately after `bun install` even when no `.env` file exists. The starter repo itself also benefits (users can run `bun run dev` without `cp` if they accept the default).

No change to `rewriteConfigEnv` is strictly required because the source file now carries the default and generated projects copy it verbatim. For safety, `rewriteConfigEnv` remains a no-op for `LOG_LEVEL` (base var always kept).

### 2. `generator/src/create-project.ts`

Fix misleading next-steps:

- In `generateProjectFromPlan()`, always include `cp .env.example .env` in `GENERATED.md`. The `databaseSteps` block currently conditional on `persistence` should be split: `envStep = "- cp .env.example .env (first run)"` is always emitted, while `dbSteps` remain conditional.

Example new fragment:

```ts
const envStep = "- cp .env.example .env  # copy env template (required: LOG_LEVEL)";
const databaseSteps = plan.features.includes("persistence")
  ? `\n${envStep}\n- bun run db:up\n- bun run db:migrate`
  : `\n${envStep}`;
```

Resulting `GENERATED.md` for minimal:

```
Next steps:
- bun install
- cp .env.example .env
- bun run dev
```

- In `printSummary()`, change `"next steps: bun install; bun run dev"` to `"next steps: cp .env.example .env; bun install; bun run dev"` or at least `"next steps: bun install; cp .env.example .env; bun run dev"` and keep the persistence suffix. This aligns console output with `README.md`’s quickstart.

### 3. `docs/reference/environment.md`

Update the base table row for `LOG_LEVEL` from `sí | —` to `no | info` to reflect the new default.

### 4. `packages/config/src/env.test.ts`

Update the test `"missing LOG_LEVEL aborts"` to expect the default (`info`) instead of throwing. The test `"ConfigError lists every issue"` should be updated to not expect `LOG_LEVEL` in the empty-env error (now only `DATABASE_URL` and `BETTER_AUTH_SECRET` remain required).

## Alternatives Considered

- **Only fix generator messaging** (keep LOG_LEVEL required): fixes documentation but still requires manual `cp` for minimal to boot; less forgiving UX. Rejected in favor of also adding default, which matches all other base vars.
- **Make LOG_LEVEL optional only in generated projects via `rewriteConfigEnv`**: would require templating divergence between source and generated code; adds complexity vs single-line default in source that benefits both.
- **Auto-create `.env` during generation**: would silently create a gitignored file with secrets placeholder; violates “never silently overwrite” and would divergently create `.env` only for minimal, confusing.

## Scope

- Files: `packages/config/src/env.ts`, `generator/src/create-project.ts`, `docs/reference/environment.md`, `packages/config/src/env.test.ts` (test adjustment).
- No spec delta required (LOG_LEVEL default is a minor spec relaxation; delta spec would only be needed if we treated it as normative change, but hotfix keeps it as bug fix).
- No migration, no new dependencies, no interface addition.

## Verification

- Reproduce: `bun generator/src/create-project.ts --profile=minimal --out=/tmp/gen-minimal && cat /tmp/gen-minimal/packages/config/src/env.ts` should show `.default("info")` after fix; `bun run --watch apps/api/src/server.ts` in the generated project without `.env` should not throw `LOG_LEVEL`.
- Existing generator tests: `rewriteConfigEnv` and `planProject minimal` should still pass; env tests updated accordingly.
- `bun test`, `bun run typecheck`, `bun run lint` remain green.
