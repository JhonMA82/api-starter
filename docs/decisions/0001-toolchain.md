# ADR-0001: Toolchain - Bun 1.3.14 + TypeScript 7.0.2

- Status: Accepted
- Date: 2026-08-02
- Scope: Fase 0 (research, version pins, licenses, ADRs)

## Context

The reusable Hono API starter must run on a fixed, reproducible toolchain
(spec §28 Fase 0, §30). The spec mandates a Bun-only surface: `Bun.serve` as
the only runtime adapter (`apps/api/src/server.ts`), `bun:test` for the test
suite, and `bun install` with a committed lockfile (spec §3.2). TypeScript is
required for strict typing (spec §21, design §10 flag list). Three unknowns
drove this decision:

1. Which runtime/package-manager/test-runner combination to standardize on.
2. Which TypeScript major to adopt: 7.0.2 is the new native-port (tsgo) major,
   released as `latest` on npm but with a young ecosystem.
3. Whether a single-tool DX (Bun for all three roles) outweighs the maturity of
   Node + pnpm + vitest.

## Options

1. **Bun 1.3.14 (runtime + package manager + test runner) + TypeScript 7.0.2**,
   with documented fallback `typescript@5.9.3` (last 5.x). Bun is the runtime
   the spec's Bun-only surface is built on; one tool covers runtime, PM, and
   tests; `bun.lock` is committed; `.bun-version` and `packageManager` pin the
   version; `oven/bun:1.3.14-slim` pins the Docker base.
2. **Node + pnpm + vitest + TypeScript 5.9.3**: mature, battle-tested toolchain,
   but contradicts the spec's Bun-only runtime surface and requires a Node
   adapter (`@hono/node-server`) plus a separate test runner for no spec benefit.
3. **Bun 1.3.14 + TypeScript 5.9.3 from day one**: avoids the young tsgo line,
   but forfeits the benefits of the 7.x native-port line (speed, `latest`
   support) that the spec-era ecosystem expects; 5.9.3 remains the fallback.

## Decision

Use **Bun 1.3.14** as runtime, package manager, and test runner, with
**TypeScript 7.0.2** (tsgo) as the compiler. `typescript@5.9.3` is the
documented fallback: if the 7.x typecheck binary is unavailable or broken at
install time (verified via `bun x tsc --noEmit` vs `bun x tsgo --noEmit`), swap
to 5.9.3 and record the fallback activation in the commit body.

Version pinning applies to the whole toolchain: `.bun-version` = `1.3.14`,
`packageManager` = `bun@1.3.14`, exact dependency versions only (no `^`/`~`/
`latest`), `bun.lock` committed, `--frozen-lockfile` in CI and Docker, and
`oven/bun:1.3.14-slim` as the exact Docker base tag.

## Consequences

- Single-tool DX: `bun install`, `bun test`, `bun run` cover PM/test/run; no
  separate `vitest` or `pnpm` configuration surface.
- The tsgo line is young: the fallback to 5.9.3 is a tested, documented escape
  hatch; `@types/bun@1.3.14` pins the Bun type surface.
- Docker and CI consume the same pins (exact base tag, `bun-version-file:
  .bun-version`), keeping local, CI, and container behavior aligned.
- The catalog (`catalog/dependencies.json`) registers every toolchain pin with
  license, purpose, and verification source (spec §30, "registrar licencias").

## Revisit conditions

Revisit this ADR at **Fase 2**, when Drizzle Kit (or any native/Node-FFI
tooling) enters the toolchain, or earlier if the TypeScript 7.x typecheck
binary proves unusable and the 5.9.3 fallback must be activated.
