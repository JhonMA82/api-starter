# ADR-0011: Frontend integration kits - framework-agnostic SDK with optional adapters

- Status: Accepted
- Date: 2026-08-03
- Scope: Fase 9 (frontend integration kits)

## Context

Fase 9 (spec §17.1-17.4) adds frontend integration kits so web, mobile and
desktop clients can consume the API without re-implementing its resource
contracts or duplicating its security logic. The scope covers a TanStack Query
browser data layer (§17.1), a Next.js App Router client (§17.2), an
Ignite/React Native mobile client (§17.3) and a Tauri desktop client (§17.4).
The n8n and Python kits referenced by the broader spec are out of scope for
this phase by user decision and remain future work.

The kits must respect the existing architecture: the API is the only backend
boundary, authorization is enforced server-side (never only in frontend
loaders), and the shared code cannot couple itself to any framework so that
one client surface serves web, mobile and desktop consumers alike.

## Options

1. **Framework-agnostic core SDK + dependency-free structural adapters +
   injected native bridges** [chosen]: `packages/sdk` provides typed resources
   over an injectable standard `fetch` with cookie and bearer auth, the tenant
   header `x-organization-id` (with a per-request organization override), and
   bounded RFC 9457 problem errors (`ApiClientError`). Framework-specific
   behavior ships as dependency-free structural kits (TanStack Query options,
   Next App Router server/browser clients, mobile and Tauri helpers), and
   native capabilities (secure token storage, `invoke`) are injected by the
   consuming application.
2. **Direct dependencies on React/Next/TanStack/Tauri in the SDK package**:
   rejected — it would couple the core to specific frameworks, break
   browser/server neutrality and drag heavy dependency trees into mobile and
   desktop consumers that never use them.
3. **Duplicate Next API endpoints/loaders with security logic**: rejected —
   the API remains the only backend boundary; duplicating domain endpoints in
   the frontend would fork the contracts and move security decisions into
   frontend code.
4. **AsyncStorage/localStorage plaintext tokens for mobile and Tauri**:
   rejected — tokens are credentials; mobile uses an injected secure store
   (Keychain/Keystore/SecureStore) and Tauri a native credential bridge, never
   plaintext persistence.
5. **Unbounded automatic retries**: rejected — the offline kit uses bounded
   exponential retry with jitter plus idempotency headers so replays cannot
   duplicate side effects or hammer the API.

## Decision

Ship Fase 9 as `packages/sdk` (`@consulting/sdk`, 0.1.0) with a
framework-agnostic core, typed resource clients and dependency-free structural
kits; integration examples live under `integrations/`.

- **Core SDK:** injectable standard `fetch`, cookie and bearer auth, the
  tenant header `x-organization-id` (with per-request organization override),
  JSON/204/FormData responses and bounded RFC 9457 problem errors
  (`ApiClientError`). Typed resources cover auth, organizations, apiKeys,
  files and webhooks. No runtime dependencies; no Node/Bun/React/Next/Tauri
  imports. The SDK sits outside the generator's runtime profiles: generated
  backend projects prune it unless a future frontend feature selects it.
- **TanStack Query kit (`src/tanstack.ts`):** dependency-free stable query
  keys/options structurally compatible with TanStack Query v5 — factories for
  session, organizations, organizationContext, files, webhooks and apiKeys,
  plus mutation invalidation descriptions. Consumers wrap them with their own
  installed `@tanstack/react-query`.
- **Next.js kit (`src/next.ts`):** App Router server client that forwards
  cookies explicitly (no `next/headers` import), defaults sensitive data to
  `cache: no-store` while supporting intentional `revalidate`/tags, and a
  browser client with `credentials: "include"` and stable query tags. No
  duplicate API routes and no secrets in `localStorage`.
- **Mobile kit (`src/mobile.ts`):** bearer client over an injected secure
  token store (Keychain/Keystore/SecureStore) with single-flight refresh,
  `credentials: "omit"`, idempotency keys and an upload form helper.
- **Offline kit (`src/offline.ts`):** durable mutation queue with an
  in-memory store for tests, bounded exponential retry with jitter,
  idempotency headers, no payload logging and no background timers.
- **Tauri kit (`src/tauri.ts`):** credential bridge over an injected `invoke`,
  system-browser auth callback with scheme validation, and no plaintext
  secrets or `localStorage`.
- **Examples and validation:** `integrations/` holds example projects
  (tanstack-query, next-app-router, ignite-react-native, tauri). No frontend
  package manifests are added to the starter. Validation: 84 SDK tests
  (32 core + 25 web + 27 mobile/tauri); the full suite (~788 no-DB tests) and
  the coverage gate pass.

## Consequences

- The SDK stays dependency-free and framework-neutral; consumers install and
  own their frameworks (e.g. `@tanstack/react-query`), and native capabilities
  are injected rather than imported.
- Generated backend projects exclude the SDK until a future frontend feature
  selects it, keeping generated output free of unused frontend surface.
- Security decisions stay in the API; the kits only carry credentials and
  headers, so frontend loaders never become authorization boundaries.
- Lint, typecheck and coverage remain green (84 new SDK tests, coverage exit
  0).
- The n8n and Python kits are deferred to a future phase and are not
  documented as implemented.

## Revisit conditions

Revisit when any of the following holds:

- The SDK gains real framework devDependencies or starts shipping templates
  for a frontend project profile.
- A frontend project profile is added to the generator.
- The n8n or Python kits are scoped and implemented.
- A security review of the bridge boundaries (secure store injection, Tauri
  `invoke`, auth callback schemes) is required.
