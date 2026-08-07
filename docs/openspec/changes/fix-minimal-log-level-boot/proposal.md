# Proposal: fix-minimal-log-level-boot

## Problem

Generating a project with `--profile=minimal` and following the printed next steps:

```bash
bun generator/src/create-project.ts --profile=minimal --out=../tteees
cd ../tteees
bun install
bun run dev
```

fails immediately with:

```
ConfigError: Invalid environment configuration:
  - LOG_LEVEL: Invalid option: expected one of "debug"|"info"|"warn"|"error"
      at parseEnv (packages/config/src/env.ts:51:11)
      at apps/api/src/server.ts:10:16
```

The generated `packages/config/src/env.ts` defines `LOG_LEVEL` as `z.enum([...])` without a default, so `parseEnv()` requires `LOG_LEVEL` in `process.env`. The generated `.env.example` contains `LOG_LEVEL=info`, but no `.env` file exists after generation (`.env` is gitignored and intentionally not copied). Bun only auto-loads `.env`, not `.env.example`. Without `cp .env.example .env`, `LOG_LEVEL` is `undefined` and validation fails.

Two contributing defects:

1. **Source schema defect**: `LOG_LEVEL` is the only base env var without a default (`APP_ENV`, `APP_VERSION`, `API_BASE_URL`, `PORT`, `HOST` all have `.default()`). Every generated project — including `minimal` — always keeps `LOG_LEVEL` (BASE_ENV_VARS), yet it remains mandatory. The reference doc `docs/reference/environment.md` marks `LOG_LEVEL` as required with no default, but the minimal profile is marketed as “public APIs without persistence or user accounts” and should boot with minimal setup. Requiring an explicit `LOG_LEVEL` forces an extra `cp .env.example .env` step even when no other required vars exist.

2. **Generator messaging defect**: `generator/src/create-project.ts` prints `next steps: bun install; bun run dev` for every profile and only appends `cp .env.example .env; bun run db:up; …` when `persistence` is present. For `minimal` (no persistence), the printed `GENERATED.md` and console summary omit the `cp .env.example .env` instruction entirely, contradicting `README.md` and `docs/getting-started/create-a-project.md` which explicitly require `cp .env.example .env` before `bun run dev`. Users who follow the generator’s own output hit the ConfigError.

## Root Cause

- `packages/config/src/env.ts:5` — `LOG_LEVEL: z.enum(["debug","info","warn","error"])` has no `.default()`, so `parseEnv({})` fails. All sibling base vars have defaults.
- `generator/src/create-project.ts:268-282` — `databaseSteps` and `printSummary()` only mention `cp .env.example .env` for `persistence` profiles. `GENERATED.md` for minimal therefore lists only `bun install` / `bun run dev`.
- `generator/src/prune.ts:214-226` — `rewriteConfigEnv` makes `DATABASE_URL` and `BETTER_AUTH_SECRET` optional for pruned features but does not handle `LOG_LEVEL`.

## Fix Goal

- Minimal (and every) generated project boots with `bun run dev` after `bun install` without requiring a pre-existing `.env`, OR at minimum the generator’s next-steps accurately instruct `cp .env.example .env`.
- Minimal change, no new capabilities or public API: make `LOG_LEVEL` default to `"info"` in the source schema so both the starter and all generated projects tolerate a missing env var, and align generator messaging to always include `cp .env.example .env` in `GENERATED.md` and console output.
- Preserve `docs/reference/environment.md` consistency: update the table to reflect the new default.
- Existing tests that assert “missing LOG_LEVEL throws” must be updated to reflect the new defaulting behavior.
