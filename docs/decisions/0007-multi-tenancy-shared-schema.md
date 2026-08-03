# ADR-0007: Multi-tenancy - shared schema, tenant-scoped repositories, lifecycle invariants

- Status: Accepted
- Date: 2026-08-03
- Scope: Fase 5 (multi-tenant profile)

## Context

Fase 5 (spec §4.4, §11.1-11.8, §12.1) requires the multi-tenant profile of the
starter: organizations with memberships and invitations, tenant resolution per
request, isolation between tenants, and an audit trail per tenant (§4.4
"auditoría por tenant"). Spec constraints that shape the choice:

- §11.2: shared-schema model; each tenant row carries `organization_id` and
  repositories scope every query to the tenant.
- §11.4: mandatory resolution flow — the request carries `x-organization-id`
  and the membership is resolved before any tenant-scoped operation; unknown
  organizations must not leak (404 vs 403 distinction).
- §11.5/§11.6: IDOR protection — tenant-scoped reads and writes must always
  include the tenant scope (`{ organizationId, id }` filters, global token
  hash lookups for invitations).
- §11.8: lifecycle invariants — last-owner guard, strong-confirmation
  deletion, invitation expiry and single-use.
- §4.7: anti-overengineering — one module per cluster of related aggregates;
  defer speculative role machinery.

Fase 4 shipped single-tenant authorization (global roles, `request.*`
permission catalog) and the append-only audit log (`packages/audit`, migration
0003). Fase 5 builds tenant-scoped roles (owner/admin/auditor/member) inside
the membership row and reuses the audit package for per-tenant records.

## Options

1. **Shared schema + row separation by `organization_id`** [chosen]: one
   database, one schema; every tenant resource row carries
   `organization_id`, repositories filter by tenant, and a mandatory
   resolution flow guards tenant-scoped routes. Matches spec §11.2 and keeps
   migrations, tooling, and CI unchanged.
2. **Per-tenant database**: rejected — spec §11.2; multiple databases per
   tenant blow up migration/backup tooling, connection management, and CI for
   a starter, without adding isolation the application cannot already provide
   at this stage.
3. **Dynamic role tables now** (`role_permissions`, `membership_roles`):
   rejected — deferred (§4.7 anti-overengineering). Predefined org roles
   (owner/admin/auditor/member) as a membership column are sufficient for the
   starter profile; dynamic roles add tables, admin surface, and joins with
   no current consumer. Revisit condition: a client that needs custom roles.
4. **Row-level security (RLS) now**: deferred — spec §11.7 treats RLS as an
   optional defense-in-depth layer, not a substitute for application
   authorization. The tenant-scoped repository contract and IDOR tests
   provide the required isolation at the application boundary.

## Decision

Ship the tenant cluster as one module with tenant-scoped persistence,
a mandatory resolution flow, and per-tenant audit.

- **`modules/organizations`** hosts the whole cluster (organizations,
  memberships, invitations) in ONE module per spec §4.7, with the standard
  `domain ← application ← http` layering and migration 0004
  (organizations/memberships/invitations tables with FK cascades, unique
  constraints, and `expires_at`/`used_at` for invitations).
- **Predefined org roles** are a `membership.role` column
  (owner/admin/auditor/member); ownership is a single-owner invariant
  enforced by the use cases and the last-owner guard (§11.8). No dynamic
  role tables (option 3).
- **Tenant resolution**: `TenantContext` + `tenancy-service`
  (`resolveTenantContext({ organizationId, userId })`) built on the
  `x-organization-id` header; the tenant middleware resolves the context
  before tenant-scoped handlers. Unknown organizations are 404, suspended
  organizations and missing/inactive memberships are 403 — existence of
  other tenants never leaks.
- **Tenant-scoped repositories**: every membership/invitation lookup takes
  `{ organizationId, id }`; invitations are additionally found by global
  token hash (not by id); IDOR tests prove cross-tenant access is rejected.
- **Lifecycle use cases** (§11.4/§11.8): create (with slug uniqueness),
  invite (one-time token, role constraints), accept (expiry + single-use),
  transfer ownership (previous owner demoted to admin), suspend (members
  lose access), remove member (last owner cannot be removed), and delete
  with strong confirmation (`confirm=true`, memberships/invitations
  cascade).
- **Per-tenant audit** (§4.4, §11.4 step 8): the HTTP layer builds audit
  entries through `createOrganizationAudit` (`modules/organizations`) on
  top of `packages/audit`; every lifecycle success records
  `resourceType: "organization"`, `resourceId: <organizationId>`, the
  actor, and the outcome; audit is best-effort and never breaks the
  business operation.

## Consequences

- Catalog unchanged: no new external dependencies (only the existing
  `workspace:*` packages).
- The committed migration suite journal moves to 5 migrations (0000-0004).
- OpenAPI/route surface grows: `POST /organizations`,
  `GET /organizations/:id` (tenant context), `POST /:id/invitations`,
  `POST /accept-invitation`, `POST /:id/ownership`, `POST /:id/suspend`,
  `DELETE /:id/members/:userId`, `DELETE /:id?confirm=true`.
- Boundary rules unchanged: the module HTTP layer uses structural typing
  (no `@consulting/auth` imports in `modules/*`); the boundary test still
  passes.
- CP-B coverage extension: `modules/organizations/src/infrastructure/**`
  and `tests/fakes.ts` join the no-DB coverage ignore list; the
  organizations real-DB tests (repositories, migrations, lifecycle
  invariants, tenancy HTTP + audit rows) run in the integration jobs.

## Revisit conditions

Revisit when any of the following holds:

- Dynamic org roles / `role_permissions` become a client requirement
  (option 3).
- RLS is required by a client (spec §11.7 defense-in-depth) — treat as an
  addition over the application boundary, never a replacement.
- Per-tenant audit query and retention requirements grow (filtering by
  tenant, purge windows, export tooling).
- Session revocation on critical changes (§11.8: invalidate sessions when a
  membership or role changes) — explicitly NOT implemented in Fase 5;
  scheduled for review when session/revocation requirements are defined.
