# Arquitectura

## Visión: monolito modular

La API es un **monolito modular**: un único proceso y despliegue, pero el código está dividido en módulos con límites claros que permiten extraer servicios si el proyecto crece. Cada módulo sigue una tríada interna de capas — `domain`, `application`, `http` — y los paquetes compartidos (`packages/*`) contienen lógica de plataforma sin lógica de negocio.

El objetivo de Fase 0+1 es la fundación: un núcleo HTTP mínimo, reproducibilidad total (pins exactos, lockfile congelado, imagen Docker no-root) y un solo módulo de ejemplo que demuestre el patrón de capas.

## Dirección de dependencias

```
domain ← application ← http
```

- `domain`: lógica pura, sin importaciones de Hono ni Bun, sin E/S. (ej. `modules/example/src/domain/greeting.ts`).
- `application`: orquesta la capa `domain`; puede depender de contratos y de `packages/core`; sin Hono ni Bun.
- `http`: rutas de Hono, validación con zod y respuesta `application/problem+json`; es la única capa que conoce el framework.
- `packages/*`: plataforma compartida — `config` (entorno), `core` (modelo de errores RFC 9457 + contrato de logger), `contracts` (schemas zod base), `auth` (identidad y sesiones con Better Auth), `auth-client` (cliente browser-safe), `authorization` (catálogo de permisos, roles y políticas ABAC puras, deny by default), `audit` (log append-only). Regla de límites: los paquetes no importan Hono ni Bun, con la excepción explícita de `auth` (Hono solo como tipo y better-auth) y `auth-client` (solo better-auth); `authorization` es 100% puro (sin dependencias de runtime) y `audit` puede importar drizzle-orm y postgres pero no Hono ni Bun ni better-auth; `modules/*` no importan `@consulting/auth` ni `@consulting/auth-client`.
- `apps/api`: composición — middleware pipeline, rutas base, `openapi.json` y `/docs`, bootstrap y el entrypoint `server.ts`.

**Único archivo que toca APIs de Bun:** `apps/api/src/server.ts` (`Bun.serve`, shutdown con drenado). Es la frontera de portabilidad del proyecto.

## Matriz de portabilidad

| Superficie | Dependencia | Estado | Ruta de migración a Node |
|---|---|---|---|
| Servidor HTTP | `Bun.serve` (en `apps/api/src/server.ts`) | En uso | `@hono/node-server` — **NO instalado**, solo documentado |
| Runner de tests | `bun:test` | En uso | Node 20+ `node:test` o vitest |
| Gestión de paquetes | bun (workspaces, `bun install --frozen-lockfile`) | En uso | pnpm/npm workspaces |
| Typecheck | TypeScript 7.0.2 (`tsc` de tsgo) | En uso | versiones LTS de TypeScript (fallback documentado: 5.9.3, ADR-0001) |
| Formato/lint | Biome 2.5.6 | En uso | multiplataforma (no es específico de Bun) |
| `process.env` en vez de `Bun.env` | — | En uso | sin cambios |
| Docker | `oven/bun:1.3.14-slim` | En uso | imagen Node `22-slim` + `npm ci` |

La ruta Node vía `@hono/node-server` está **documentada, no instalada**: el único archivo a tocar sería `apps/api/src/server.ts`, porque el resto del código no depende de Bun. Ver ADR-0001 para la política de toolchain y su revisión en Fase 2.

## Autenticación (Fase 3)

Better Auth 1.6.25 queda aislado en `packages/auth` (`@consulting/auth`): un único
export `createAuth(options)` que devuelve `{ handler, sessionMiddleware, getSession, close }`,
usando el adaptador drizzle sobre la migración 0002 (tablas `user`/`session`/`account`/
`verification`) con email/contraseña y los plugins `bearer()` y openAPI. `close()`
cierra el cliente postgres del paquete.

- **Costura de inyección:** `createApp(config, { auth })` recibe la instancia como
  dependencia opcional. Cuando está presente, monta
  `app.on(["POST", "GET"], "/api/auth/*", auth.handler)` **después** de la cadena de
  middleware (requestId → jsonLogger → secureHeaders → cors → bodyLimit → timeout →
  compress) e inyecta el middleware de sesión; las rutas leen `c.get("user")` y
  `c.get("session")` (`null` sin sesión).
- **Sesión y credenciales:** cookies `HttpOnly`, `SameSite=Lax` y `Secure` bajo HTTPS;
  tokens bearer con el plugin `bearer()`; el esquema OpenAPI 3.1.1 del subsistema se
  expone como fuente "Auth" en Scalar `/docs`.
- **Política de orígenes:** los orígenes de cada petición se validan contra el origen
  de `API_BASE_URL` y la lista `TRUSTED_ORIGINS`; los ajenos se rechazan
  (`403 INVALID_ORIGIN`).
- **Límites de capas:** `packages/auth` es la única excepción de `packages/*` que
  importa Hono (solo tipos) y better-auth; `packages/auth-client` (cliente
  browser-safe para web) solo importa better-auth y nunca Hono ni Bun. `modules/*`
  no importan `@consulting/auth` ni `@consulting/auth-client`.
- **Autenticación ≠ autorización:** Fase 3 responde a *quién eres*; la autorización
  (roles, catálogo de permisos y funciones de política) se implementa en la
  Fase 4 (ver [Autorización (Fase 4)](#autorización-fase-4)).

## Autorización (Fase 4)

La autorización responde a *qué puedes hacer* y es una preocupación separada de la
autenticación (spec §10.2): los roles de Better Auth son identidad, no política de
negocio. La decisión de permisos se aplica siempre en el backend; ocultar botones
en el frontend es solo UX.

- **Núcleo puro (`packages/authorization`, `@consulting/authorization`):** catálogo
  explícito `PERMISSIONS` con 9 permisos `request.*` (create/read/update/assign/
  review/approve/reject/export/delete, sin wildcards), roles `admin`/`reviewer`/
  `member` con la tabla de concesiones `ROLE_PERMISSIONS`, `authorize(actor,
  permission)` deny-by-default (roles desconocidos se ignoran, sin roles → `false`)
  que lanza `AuthorizationError`, y funciones de política ABAC explícitas en
  `policy.ts` (`canUpdateRequest` owner-or-draft, `canApproveRequest` submitted +
  separación de funciones, `canDeleteRequest`). `PERMISSION_MATRIX` y
  `rolesForPermission` se calculan desde las concesiones de roles (matriz
  declarativa, spec §12.5) con tests que prueban que ningún permiso queda huérfano.
- **Enforcement HTTP (`apps/api`):** middleware `requirePermission(permission,
  resolveRoles)` — sin sesión → `401 UNAUTHORIZED`; `authorize()` falso → `403
  FORBIDDEN` (códigos nuevos en `packages/core/src/problem.ts`); la costura
  `createApp(config, { auth, getRoles })` recibe el resolvedor de roles, con
  default `async () => []` (deny by default). Rutas demo documentadas:
  `GET /api/v1/authorization/protected` (`request.read`) y
  `GET /api/v1/authorization/admin` (`request.delete`, solo admin).
- **Auditoría append-only (`packages/audit`, `@consulting/audit`):** tabla
  `audit_log` (migración 0003) con id/actor_user_id/action/resource_type/
  resource_id/outcome/metadata jsonb/created_at e índices sobre `created_at` y
  `resource_type`; el trigger `audit_log_append_only` + la función
  `reject_audit_log_mutation()` rechazan UPDATE/DELETE a nivel de base de datos
  (spec §13.1: el invariante sobrevive a bugs de la aplicación).
  `createAuditLogger(db)` expone solo `record(input)` y `list({ limit? })`
  (más recientes primero, default 100, tope 1000) — sin API de borrado. Tests de
  DB reales (incluido el rechazo del trigger) y extensión de cobertura CI (CP-B).
- **Límites de capas:** `packages/authorization` es 100% puro (sin dependencias de
  runtime); `packages/audit` puede importar drizzle-orm y postgres pero no Hono ni
  Bun ni better-auth. La decisión de permisos vive en la capa http vía
  `requirePermission`, nunca dentro de repositorios.

## Multi-tenancy (Fase 5)

El perfil multi-tenant responde a *de qué organización eres miembro y qué puedes
hacer en ella* (spec §4.4, §11.1-11.8): modelo **shared schema** (§11.2) — una
sola base de datos, filas por tenant con `organization_id`, repositorios que
siempre acotan por tenant. Ver ADR-0007.

- **Cluster `modules/organizations`** (un solo módulo por cluster, §4.7):
  organizaciones, membresías e invitaciones con la tríada `domain ←
  application ← http` y la migración 0004 (cascadas FK, unicidad, expiración y
  uso único de invitaciones).
- **Roles de organización predefinidos** como columna `membership.role`
  (owner/admin/auditor/member); propiedad con un único owner (guard del último
  owner, §11.8). Sin tablas dinámicas de roles (diferido, §4.7).
- **Resolución de tenant:** cabecera `x-organization-id` + `TenantContext` +
  `tenancy-service` (`resolveTenantContext`); el middleware de tenant resuelve
  el contexto antes de cada handler tenant-scoped. Organizaciones desconocidas
  → 404; suspendidas o sin membresía activa → 403; la existencia de otros
  tenants nunca se filtra (§11.5/11.6).
- **Repositorios tenant-scoped:** búsquedas de membresía/invitación con
  `{ organizationId, id }`; las invitaciones se resuelven por hash global del
  token (nunca por id desnudo); tests IDOR prueban el rechazo del acceso
  cross-tenant.
- **Ciclo de vida** (§11.4/§11.8): crear (slug único), invitar (token de un
  solo uso, restricciones de rol), aceptar (expiración + no reutilizable),
  transferir propiedad (el owner anterior pasa a admin), suspender (los
  miembros pierden acceso), eliminar miembro (el último owner no puede
  eliminarse) y borrar con confirmación fuerte (`confirm=true`, cascada de
  membresías e invitaciones).
- **Auditoría por tenant** (§4.4, §11.4 paso 8): la capa http registra cada
  éxito del ciclo de vida vía `createOrganizationAudit`
  (`modules/organizations`) sobre `packages/audit` — `resourceType:
  "organization"`, `resourceId: <organizationId>`, actor y outcome; la
  auditoría es best-effort y nunca rompe la operación de negocio.
- **Superficie HTTP:** `POST /organizations`, `GET /organizations/:id`
  (contexto de tenant), `POST /:id/invitations`, `POST /accept-invitation`,
  `POST /:id/ownership`, `POST /:id/suspend`, `DELETE /:id/members/:userId`,
  `DELETE /:id?confirm=true`.
- **Límites de capas:** el módulo usa tipado estructural para la sesión (sin
  importar `@consulting/auth`); `modules/organizations` puede importar
  `@consulting/audit` (tipos y API de registro) desde la capa http/application.

## Perfiles y fases futuras (resumen)

- **Fase 0+1 (completada):** fundación — registros, ADRs, núcleo HTTP con rutas base, OpenAPI 3.1 + Scalar, módulo de ejemplo, Docker y CI de 5 jobs.
- **Fase 2 (completada, persistencia):** PostgreSQL 17 + Drizzle ORM sobre postgres.js, migraciones SQL commitadas bajo `migrations/`, módulo `notes` de referencia con tests de DB reales, scripts `db:*` con podman, perfil `database` en Docker Compose y CI de 8 jobs. Ver ADR-0005 y `docs/migrations-runbook.md`.
- **Fase 3 (completada, autenticación):** Better Auth 1.6.25 aislado en `packages/auth` (`@consulting/auth`) con adaptador drizzle (migración 0002: `user`/`session`/`account`/`verification`), email/contraseña y plugins `bearer()`/openAPI; cliente browser-safe `packages/auth-client`; montaje de `/api/auth/*` y middleware de sesión vía la costura `createApp(config, { auth })`; tests de DB reales y extensión de CI. Ver [Autenticación (Fase 3)](#autenticación-fase-3).
- **Fase 4 (completada, autorización single-tenant):** catálogo explícito de permisos `request.*`, roles admin/reviewer/member y políticas ABAC en `packages/authorization` (deny by default); enforcement HTTP con `requirePermission` y la costura `getRoles` (códigos `401 UNAUTHORIZED` / `403 FORBIDDEN`, rutas demo `/api/v1/authorization/*`); auditoría append-only `audit_log` (migración 0003) con trigger de base de datos en `packages/audit`. Ver [Autorización (Fase 4)](#autorización-fase-4).
- **Fase 5 (completada, multi-tenancy):** `modules/organizations` (organizaciones/membresías/invitaciones, migración 0004) con shared schema; roles de org predefinidos (owner/admin/auditor/member); `TenantContext` + flujo de resolución con `x-organization-id`; repositorios tenant-scoped con protección IDOR; ciclo de vida completo (crear/invitar/aceptar/transferir/suspender/eliminar miembro/borrar con confirmación) e invariantes (§11.8); auditoría por tenant sobre `packages/audit` y ADR-0007. Ver [Multi-tenancy (Fase 5)](#multi-tenancy-fase-5).
- **Fases posteriores:** sin comprometer detalles concretos — la Fase 6 será integraciones (outbox, worker, webhooks, API keys) sobre los perfiles multi-tenant y single-tenant actuales; además se prevé crecimiento hacia rutas HTTP del módulo `notes` y más módulos de negocio bajo `/api/v1`, junto con la revisión de decisiones que lo requieran (p.ej. manejo de secretos, gate de capas automatizado).
- **Perfil Docker `core`:** solo el servicio `api`. La base de datos vive en el perfil `database` (postgres) y no es un requisito del servidor HTTP.

## Modelo de datos y errores

- Errores: RFC 9457 (`application/problem+json`) con `code` estable, `requestId` e `instance`; un único normalizador (`onError`/`notFound`) mapea status → código. Ver ADR-0003.
- Contratos: schemas zod en `packages/contracts` (base) y co-localizados en cada módulo; alimentan tipos, documento OpenAPI 3.1 y tests (triple fuente). Ver ADR-0002.
