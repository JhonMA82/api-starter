# ADR-0009: Files and notifications - storage abstraction, signed URLs, mailer interfaces

- Status: Accepted
- Date: 2026-08-03
- Scope: Fase 7 (files & notifications)

## Context

Fase 7 (spec §15, §16) adds the files and notifications profile to the
starter. Spec constraints that shape the choice:

- §15: uploaded files are stored as REFERENCES in PostgreSQL, never as
  blobs; uploads are never served from the API process itself; downloads
  use signed URLs; files carry size and MIME limits; names are
  server-generated; content is hashed; every file belongs to a tenant.
- §16: mail sending goes through `Mailer`/`NotificationChannel`/
  `TemplateRenderer` interfaces with no provider coupling; templates are
  versioned; Spanish is the default locale; logs never include sensitive
  content; sends are retried and deduplicated.

Fase 6 shipped the integration cluster (outbox, JobQueue, API keys,
webhooks — ADR-0008) with `modules/jobs` hosting the `JobQueue`. Fase 7
builds on top: the notification module reuses the JobQueue for async
sending, and the files module reuses the organizations tenancy via an
injected membership guard.

## Options

1. **FileStorage interface + metadata table + HMAC signed URLs +
   interface-based mailer/templates** [chosen]: an abstract `FileStorage`
   with in-memory (tests) and local-filesystem (dev) adapters, a `files`
   metadata table with REFERENCES-only storage, HMAC-signed download
   tokens, and `Mailer`/`NotificationChannel`/`TemplateRenderer`
   interfaces with versioned code-first templates. Matches spec §15 and
   §16 with no new external dependencies.
2. **Store blobs in PostgreSQL**: rejected — §15 requires files to be
   references, not blobs; large binary payloads bloat the database,
   backups and connection pooling.
3. **Direct static serving of uploads from the API process**: rejected —
   §15 forbids serving uploads from the API process; that coupling makes
   the upload path and the serving path share failure modes and prevents
   a future object-store drop-in.
4. **Couple to a mail provider (Resend/SendGrid)**: rejected — §16
   requires provider-agnostic interfaces; a provider adapter is an
   additive change behind the interface, and the SMTP/HTTP adapter is
   stubbed to fail fast until a transport is chosen.
5. **Filesystem path as storage key**: rejected — storage keys are
   server-generated with a tenant prefix (`<orgId>/<uuid>/<name>`), so
   callers never control paths and cross-tenant collisions are
   structurally impossible.

## Decision

Ship Fase 7 as `modules/files` (`@consulting/module-files`) and
`modules/notifications` (`@consulting/module-notifications`).

- **File storage (§15):** a `FileStorage` interface with an in-memory
  adapter (tests) and a local-filesystem adapter (dev); S3/R2/MinIO
  adapters are a drop-in later. The `files` metadata table (migration
  0010) holds REFERENCES only — no blobs in PostgreSQL. Rows are
  tenant-scoped (`organization_id` FK with cascade), storage keys are
  server-generated (`<orgId>/<uuid>/<name>`), filenames are sanitized,
  and each upload records a sha256 content hash. Limits: 10 MiB size cap
  and a MIME allowlist (png/jpeg/webp/pdf/txt/json).
- **Use cases (§15):** upload, download, soft-delete and list, with an
  injected `MembershipGuard` (wired to the organizations tenancy in
  `apps/api`). Deletion is soft-delete only; hard deletion and the
  retention job are deferred.
- **Signed URLs (§15):** download tokens are
  `<base64url(JSON {fileId, organizationId, exp})>.<hex(HMAC-SHA256(secret,
  payload))>`; verification is timing-safe and never throws — expired or
  malformed tokens yield 401, deleted or missing files 404. The download
  route `GET /api/v1/files/download?token` is PUBLIC: the signed token IS
  the authorization. Fresh URLs are issued on demand
  (`POST /api/v1/files/:id/url`, default 3600s, cap 86400s) and uploads
  return a one-time `downloadUrl` (201).
- **Notifications (§16):** `Mailer`/`NotificationChannel`/
  `TemplateRenderer` interfaces with no provider coupling — the SMTP stub
  throws fail-fast with "transport not implemented", a log-mailer covers
  dev previews, and a noop mailer covers tests. Templates are versioned
  and code-first (`invitation.v1` es+en, `welcome.v1` es-only) with
  es-default fallback (exact locale → es → first available) and `{var}`
  substitution.
- **Deduplication and async sending (§16):** a `sent_mails` ledger
  (migration 0011) with a unique `dedupe_key` and `onConflictDoNothing`;
  the send service detects duplicates, renders, then enqueues a
  `notification.send` job via the JobQueue (or sends synchronously); the
  worker re-checks dedupe before sending and rethrows
  `MailerUnavailableError` so the jobs retry policy handles it. Logs
  never include bodies — only to/template/dedupe/subject.

## Consequences

- The committed migration suite journal moves to 12 migrations
  (0000-0011) and 17 public tables (previous 16 + `sent_mails`).
- `modules/files` hosts the files cluster (FileStorage, metadata table,
  signed URLs, upload/download/soft-delete/list use cases);
  `modules/notifications` hosts the mailer, templates and send service.
- Catalog unchanged: no new external dependencies.
- The signed download route is public-by-token — the token IS the
  authorization; it verifies identity, tenant and expiry in one
  timing-safe check.
- The mailer provider adapter is stubbed (fail-fast SMTP); no real
  transport exists yet in the starter.
- Boundary rules unchanged: `modules/*/src/domain` and
  `modules/*/src/application` stay Hono/Bun-free; the notification module
  depends on `modules/jobs` (JobQueue) for async sending.

## Revisit conditions

Revisit when any of the following holds:

- Production object storage is needed — add an S3/R2/MinIO `FileStorage`
  adapter behind the existing interface (option 1).
- Hard deletion or retention is required — implement the retention job
  on top of the soft-delete design.
- A real mail transport is chosen — replace the fail-fast SMTP stub with
  an SMTP or provider adapter behind `Mailer`.
- Per-user notification preferences are required.
- Push or SMS channels are required — implement them behind
  `NotificationChannel`.
- Templates need to move out of code (admin-editable or DB-backed).
