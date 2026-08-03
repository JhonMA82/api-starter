# ADR-0004: Version pinning - exact pins everywhere

- Status: Accepted
- Date: 2026-08-02
- Scope: Fase 0 (version pins, licenses) and all later fases

## Context

The starter must be reproducible: every build, test run, and deployment must
consume the exact same dependency versions (spec §30). Floating versions
(`^`, `~`, `latest`) silently change behavior across installs and violate the
"registrar licencias" requirement of Fase 0. The toolchain is Bun-based, so
the lockfile is `bun.lock` and installs use `--frozen-lockfile`.

## Options

1. **Exact pins everywhere**: `catalog/dependencies.json` registers every pin
   with name, exact version, license, purpose, and verification source; root
   `package.json` declares exact versions (no `^`/`~`/`latest`) plus
   `"packageManager": "bun@1.3.14"`; `.bun-version` pins the runtime; `bun.lock`
   is committed; CI and Docker install with `--frozen-lockfile`; GitHub Actions
   pinned to full version tags; Docker base pinned to the exact
   `oven/bun:1.3.14-slim` tag.
2. **Semver ranges** (`^`/`~`): convenient updates, but violates spec §30 and
   makes builds nondeterministic without lockfile discipline.
3. **`latest` tags** (Bun docker tag, action majors, npm `latest`): simplest,
   but every rebuild can silently change behavior; explicitly prohibited by
   the spec and this ADR.

## Decision

Adopt **exact version pins everywhere** (option 1). All manifests use exact
versions; the catalog is the registry of record for licenses and purposes;
`bun.lock` is committed and treated as a generated artifact; `--frozen-lockfile`
is used in CI and Docker; `.bun-version` and `packageManager` pin Bun itself;
GitHub Actions are pinned to full version tags (SHA pinning optional at apply
time).

## Consequences

- Reproducible installs across local, CI, and Docker environments; the same
  byte-level dependency set everywhere.
- Upgrades become deliberate, reviewed changes: bump the version in the
  manifest, update the catalog entry (license, purpose, verification source),
  refresh `bun.lock`, and land it as its own PR - a manual bump workflow with
  an auditable trail.
- Supply-chain surface is small and auditable: catalog + lockfile enumerate
  every dependency with its license.
- Slight friction: no automatic minor/patch updates; the peer-trap risk
  (`@hono/standard-validator` must stay at 0.2.x, ADR-0002) is documented in
  the catalog to resist bun suggesting newer majors.

## Revisit conditions

Revisit when supply-chain automation (Renovate/Dependabot configured for
exact-pin bumps through the catalog workflow) is adopted, or on a **yearly**
cadence as part of the Fase 0 maintenance pass.
