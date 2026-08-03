# ADR-0006: Authorization - explicit permission catalog, deny-by-default, append-only audit

- Status: Accepted
- Date: 2026-08-03
- Scope: Fase 4 (single-tenant authorization)

## Context

Fase 4 (spec §10.2, §12.1-12.5, §13.1, §20.2) requires an authorization layer
for the starter: a permission catalog, role-to-permission grants, ABAC-style
policy functions, deny-by-default semantics, backend enforcement, and an
append-only audit log. Four spec mandates constrain the choice:

- §10.2: authentication is not authorization; the roles provided by Better Auth
  are an identity concern, not the business policy.
- §12.2: no generic JSON rules engine initially; policies are explicit code.
- §12.3: no wildcard permissions ("manage all"); every permission is explicit.
- §13.1: the audit log is append-only; mutations must be rejected.

Fase 3 shipped authentication (who you are) in `packages/auth`; Fase 4 ships
authorization (what you may do) as a separate concern, still single-tenant
(roles are global, no organizations yet — Fase 5).

## Options

1. **Pure authorization package + explicit catalog + deny-by-default + ABAC
   policy functions in code** [chosen]: `packages/authorization`
   (`@consulting/authorization`, v0.1.0) with zero runtime dependencies, an
   explicit `request.*` permission catalog, admin/reviewer/member roles, a
   deny-by-default `authorize()` core, and typed ABAC policy functions
   (`canUpdateRequest`, `canApproveRequest` with separation of duties,
   `canDeleteRequest`).
2. **Roles from Better Auth as the only policy**: rejected — spec §10.2;
   identity roles are not the business policy and would couple the policy to
   the auth provider.
3. **Generic JSON rules engine**: rejected — spec §12.2 explicitly defers any
   generic rules engine; policies must be readable, type-checked code.
4. **Wildcard "manage all" permission**: rejected — spec §12.3; every
   permission must be explicit so grants are auditable and reviewable.
5. **Audit in-app only, without a database trigger**: rejected — §13.1
   requires the append-only invariant to survive application bugs; only a
   database-level trigger enforces it unconditionally.

## Decision

Ship authorization as a pure core package plus HTTP enforcement plus a
database-enforced audit log.

- **`packages/authorization`** (`@consulting/authorization`, v0.1.0, pure
  TypeScript, no runtime deps): explicit `PERMISSIONS` catalog (9
  `request.*` permissions: create/read/update/assign/review/approve/reject/
  export/delete, no wildcards); `ROLES` = admin/reviewer/member with the
  `ROLE_PERMISSIONS` grant table (admin: all 9; reviewer:
  read/assign/review/approve/reject/export; member: create/read/update/export);
  `authorize(actor, permission)` is deny-by-default (unknown roles ignored,
  empty roles → false) and throws `AuthorizationError`; ABAC policy functions
  live in `policy.ts` (`canUpdateRequest` owner-or-draft, `canApproveRequest`
  submitted + separation of duties, `canDeleteRequest`); `PERMISSION_MATRIX`
  and `rolesForPermission` are computed from the role grants (declarative
  matrix, spec §12.5) with tests proving no permission is orphaned.
- **HTTP enforcement** (`apps/api`): new problem codes `UNAUTHORIZED` (401)
  and `FORBIDDEN` (403) in `packages/core/src/problem.ts` (ERROR_CODES,
  TITLES, statusToCode); middleware `requirePermission(permission,
  resolveRoles)` in `apps/api/src/http/authorization.ts` — no session → 401,
  `authorize()` false → 403, else `next()`; `createApp(config, { auth,
  getRoles })` seam where `getRoles` defaults to `async () => []` (deny by
  default). Two documented demo routes: `GET /api/v1/authorization/protected`
  (`request.read`) and `GET /api/v1/authorization/admin` (`request.delete`,
  admin only), both returning `{ email }` and declaring 400/401/403/500
  problem+json responses.
- **Audit** (`packages/audit`, `@consulting/audit`, v0.1.0): `audit_log`
  table (migration 0003) with id/actor_user_id/action/resource_type/
  resource_id/outcome/metadata jsonb/created_at, indexes on `created_at` and
  `resource_type`, and a BEFORE UPDATE OR DELETE trigger
  `audit_log_append_only` backed by `reject_audit_log_mutation()` enforcing
  append-only at the database level; `createAuditLogger(db)` exposes only
  `record(input)` and `list({ limit? })` (newest first, default 100, cap
  1000) — no update/delete API; blank action/resourceType/outcome raises a
  RangeError. Real-DB tests (skip without `DATABASE_URL`) include trigger
  rejection tests; CI no-DB coverage ignores `**/packages/audit/src/**` (CP-B
  pattern, DB-exercised infra).
- **Layering**: `packages/authorization` has no runtime dependencies;
  `packages/audit` may import drizzle-orm and postgres but not Hono, Bun, or
  better-auth; permission decisions are applied in the HTTP layer via
  `requirePermission`, never inside repositories.

## Consequences

- Catalog unchanged: both new packages have no external dependencies, so
  `catalog/dependencies.json` gains no entries.
- Error model grows two codes (UNAUTHORIZED 401, FORBIDDEN 403) in
  `packages/core`.
- Two demo routes under `/api/v1/authorization/*` prove the enforcement seam
  end to end.
- Migration 0003 (`audit_log`) extends the committed SQL migrations; the
  migration suite journal moves to 4 migrations.
- CI keeps its 8 jobs (no job count change); the coverage ignore pattern
  extends to `packages/audit/src` (CP-B: DB-exercised infrastructure is
  verified by the integration jobs, not the no-DB coverage run).
- Trigger-enforced append-only means accidental updates/deletes fail loudly at
  the database, independent of application code.

## Revisit conditions

Revisit when: ABAC policy conditions grow dynamic (e.g. data-dependent rules
beyond owner/draft/submitted), Fase 5 introduces multi-tenant roles
(organizations, memberships, per-org roles, isolation), or audit query and
retention requirements grow (e.g. purge windows, TTL, export tooling).
