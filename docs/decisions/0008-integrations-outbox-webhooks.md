# ADR-0008: Integrations - transactional outbox, job queue, API keys, webhooks

- Status: Accepted
- Date: 2026-08-03
- Scope: Fase 6 (integrations)

## Context

Fase 6 (spec §13.2, §14.1-14.6, §10.x) requires the integration profile of
the starter: reliable side effects after domain writes, background job
processing, organization-level API keys, and signed outgoing/incoming
webhooks. Spec constraints that shape the choice:

- §14.3: transactional outbox — domain events are appended in the SAME
  transaction as the domain write, so side effects survive or roll back
  together with the business change.
- §14.4: a JobQueue abstraction decouples use cases from any specific queue
  technology; Redis/BullMQ is only justified once Redis is already in the
  stack — a PostgreSQL adapter keeps simple installs dependency-free.
- §14.5/§14.6: outgoing and incoming webhooks need HMAC signing, replay
  protection (timestamps), and idempotency (event/request ids).
- §10.x: API keys are stored hash-only and the secret is shown once, at
  creation; keys are tenant-scoped and support expiry and revocation.
- §13.2: audit events cover API key lifecycle and webhook receipts.

Fase 5 shipped the tenant cluster (`modules/organizations`, migration 0004)
with the UnitOfWork pattern (§9.5) and per-tenant audit (`packages/audit`,
migration 0003). Fase 6 builds the integration cluster on top: the outbox
reuses the same transaction boundary, and audit records reuse
`packages/audit`.

## Options

1. **Transactional outbox (same-tx emission) + PostgreSQL JobQueue + hashed
   API keys + HMAC-signed webhooks** [chosen]: domain events appended inside
   the UnitOfWork transaction, a `JobQueue` interface with a PostgreSQL
   adapter (and an in-memory adapter for tests), hash-only API keys, and
   HMAC-signed webhooks with redaction and idempotency. Matches spec §14.3,
   §14.4, §14.5, §14.6 and §10.x with no new external dependencies.
2. **Outbox without same-transaction emission**: rejected — §14.3 mandates
   emission inside the same transaction; appending events outside it can
   publish side effects for writes that later roll back.
3. **Redis/BullMQ queue**: rejected — §14.4 reserves it for when Redis is
   already justified in the stack; the PostgreSQL adapter covers simple
   installs and the `JobQueue` interface makes a Redis adapter an additive
   change. Revisit condition: Redis becomes a justified dependency.
4. **Plaintext API keys**: rejected — §10.x requires hash-only storage; a
   leaked or stored secret in plaintext defeats the one-time-secret
   guarantee.
5. **Unsigned webhooks**: rejected — §14.5/§14.6 require HMAC signatures and
   replay protection for both outgoing deliveries and incoming receipts.

## Decision

Ship the integration cluster as: `modules/organizations` hosts the outbox,
API keys and webhook modules; `modules/jobs` hosts the JobQueue and the
outbox worker.

- **Transactional outbox (§14.3):** `outbox_events` table (migration 0005)
  with status `pending`/`processing`/`succeeded`/`failed`/`dead_letter`,
  `attempts`, `max_attempts` (5), `last_error` and `next_attempt_at`;
  `OutboxRepository` supports append with dedupe by `event_id`,
  `findPendingDue`, `markProcessing`/`markSucceeded`/`markFailed` (with an
  exponential backoff parameter), `reprocess`, and `listByStatus`. Domain
  events: `organization.created`, `member.invited`, `invitation.accepted`,
  `ownership.transferred`, `organization.suspended`, `organization.deleted`,
  `member.removed`, `api_key.created`, `api_key.revoked`.
  `create-organization` emits `organization.created` INSIDE the same
  UnitOfWork transaction.
- **JobQueue + worker (§14.4):** `modules/jobs` with the `jobs` table
  (migration 0006), a `JobQueue` interface (`enqueue`/`schedule`/`cancel`),
  a PostgreSQL adapter and an in-memory adapter (tests only). The outbox
  worker polls for due events, runs per-event handlers, retries with
  exponential backoff (`1s · 2^attempts`, capped at 1h), dead-letters after
  `max_attempts`, and supports controlled reprocessing.
- **API keys (§10.x, §13.2):** `api_keys` table (migration 0007) with
  hash-only storage (sha256), an 8-char prefix, `expires_at`, `revoked_at`,
  `last_used_at`; tenant-scoped and cascading on organization delete.
  create/revoke/verify use cases (owner/admin, one-time secret) and a
  bearer api-key middleware (the session cookie takes precedence over the
  bearer api-key). `api_key.created`/`api_key.revoked` domain events plus
  audit entries.
- **Outgoing webhooks (§14.5):** `webhook_endpoints` and
  `webhook_deliveries` tables (migration 0008); register/rotate/list/toggle
  use cases (owner/admin, one-time secret at creation and rotation).
  Deliveries are HMAC-signed: `x-webhook-signature: sha256=<hex>` over
  `timestamp + "." + body`, `x-webhook-timestamp` (unix seconds),
  `x-webhook-event-id`, `x-webhook-event-type` and an `idempotency-key`.
  Payloads are redacted (recursive strip of
  password/secret/token/authorization/api-key keys), retries use exponential
  backoff, delivery history is kept, and the outbox handler fans out to
  subscribed endpoints.
- **Webhook endpoint secrets:** stored PLAINTEXT in
  `webhook_endpoints.secret` — a server-side integration credential that the
  server needs to sign deliveries and that is never returned in responses.
  Documented decision; revisit with KMS or envelope encryption.
- **Incoming webhooks (§14.6):** a shared HMAC signature helper
  (timing-safe verification, 5-minute timestamp window); `incoming_webhooks`
  table (migration 0009) with a DB-level unique `(provider, event_id)`
  constraint for idempotency. The receive use case verifies the signature
  BEFORE parsing, stores redacted payloads (raw body retained as `{ raw }`
  when unparseable), enqueues async processing via the JobQueue, and records
  a `webhook.received` audit entry. Public route
  `POST /api/v1/webhooks/incoming/:provider` — 202 accepted/duplicate, 401
  bad signature (nothing stored), 404 unknown provider (existence is not
  revealed). Provider secrets live in a static `Map`; a DB-backed secrets
  store is documented as a future enhancement.

## Consequences

- The committed migration suite journal moves to 10 migrations (0000-0009)
  and 15 public tables (account, api_keys, audit_log, incoming_webhooks,
  invitations, jobs, memberships, notes, organizations, outbox_events,
  session, user, verification, webhook_deliveries, webhook_endpoints).
- `modules/organizations` hosts the integration cluster (outbox, API keys,
  webhooks); `modules/jobs` hosts the JobQueue and the outbox worker.
- Catalog unchanged: no new external dependencies (drizzle + postgres only,
  plus `node:crypto` from the runtime for hashing and HMAC signing).
- Audit events cover API key lifecycle (`api_key.created`,
  `api_key.revoked`) and incoming webhook receipts (`webhook.received`).
- OpenAPI/route surface grows: organization API keys (create/revoke),
  outgoing webhook management (register/list/rotate/toggle/deliveries), and
  the public incoming webhook route.
- Boundary rules unchanged: `modules/*/src/domain` and
  `modules/*/src/application` stay Hono/Bun-free; `modules/jobs` follows the
  same layering as the rest of the modules.

## Revisit conditions

Revisit when any of the following holds:

- Redis becomes a justified dependency — add a Redis/BullMQ `JobQueue`
  adapter behind the existing interface (option 3).
- Provider secrets grow beyond a static `Map` — implement a DB-backed
  secrets store for incoming webhooks.
- Webhook delivery targets need an allowlist (outbound SSRF protection).
- Delivery retries need a sweeper driven by the JobQueue (the current
  backoff is per-event in the outbox worker).
- Session revocation integrates with critical changes (§11.8) — recheck
  api-key/session interplay.
- Outbox event payloads need schema versioning once consumers evolve.
- Endpoint secrets require KMS or envelope encryption (documented plaintext
  trade-off).
