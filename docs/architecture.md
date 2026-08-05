# Arquitectura

Este documento describe la visión, las capas y el catálogo de funcionalidades de la API. Las decisiones de diseño con contexto completo viven en los [ADR](decisions/) (inglés).

## Visión: monolito modular

La API es un **monolito modular**: un único proceso y despliegue, pero el código está dividido en módulos con límites claros que permiten extraer servicios si el proyecto crece. Cada módulo sigue una tríada interna de capas — `domain`, `application`, `http` — y los paquetes compartidos (`packages/*`) contienen lógica de plataforma sin lógica de negocio.

## Dirección de dependencias

```
domain ← application ← http
```

- `domain`: lógica pura, sin importaciones de Hono ni Bun, sin E/S (ej. `modules/example/src/domain/greeting.ts`).
- `application`: orquesta la capa `domain`; puede depender de contratos y de `packages/core`; sin Hono ni Bun.
- `http`: rutas de Hono, validación con zod y respuesta `application/problem+json`; es la única capa que conoce el framework.
- `packages/*`: plataforma compartida — `config` (entorno), `core` (errores RFC 9457, logger, métricas, tracer), `contracts` (schemas zod base), `auth`, `auth-client`, `authorization`, `audit`, `sdk`. Regla de límites: los paquetes no importan Hono ni Bun, con la excepción explícita de `auth` (Hono solo como tipo y better-auth) y `auth-client` (solo better-auth); `authorization` es 100% puro (sin dependencias de runtime) y `audit` puede importar drizzle-orm y postgres pero no Hono ni Bun ni better-auth. Los `modules/*` no importan `@consulting/auth` ni `@consulting/auth-client`.
- `apps/api`: composición — middleware pipeline, rutas base, `openapi.json` y `/docs`, bootstrap y el entrypoint `server.ts`.

**Único archivo que toca APIs de Bun:** `apps/api/src/server.ts` (`Bun.serve`, shutdown con drenado). Es la frontera de portabilidad del proyecto.

## Matriz de portabilidad

| Superficie | Dependencia | Estado | Ruta de migración a Node |
|---|---|---|---|
| Servidor HTTP | `Bun.serve` (en `apps/api/src/server.ts`) | En uso | `@hono/node-server` — no instalado, solo documentado |
| Runner de tests | `bun:test` | En uso | Node 20+ `node:test` o vitest |
| Gestión de paquetes | bun (workspaces, `bun install --frozen-lockfile`) | En uso | pnpm/npm workspaces |
| Typecheck | TypeScript 7.0.2 (`tsc` de tsgo) | En uso | versiones LTS de TypeScript (fallback documentado: 5.9.3, ADR-0001) |
| Formato/lint | Biome 2.5.6 | En uso | multiplataforma (no es específico de Bun) |
| `process.env` en vez de `Bun.env` | — | En uso | sin cambios |
| Docker | `oven/bun:1.3.14-slim` | En uso | imagen Node `22-slim` + `npm ci` |

La ruta Node vía `@hono/node-server` está **documentada, no instalada**: el único archivo a tocar sería `apps/api/src/server.ts`, porque el resto del código no depende de Bun. Ver ADR-0001 para la política de toolchain.

## Configuración

`packages/config` valida el entorno con zod **antes** de arrancar el servidor (`parseEnv` en `server.ts`): si falta una variable obligatoria o un valor es inválido, el proceso falla de inmediato con el detalle de los problemas (fail-fast). Las variables se documentan en el [README](../README.md#variables-de-entorno).

## Autenticación

Better Auth 1.6.25 queda aislado en `packages/auth` (`@consulting/auth`): un único export `createAuth(options)` que devuelve `{ handler, sessionMiddleware, getSession, close }`, usando el adaptador drizzle sobre la migración 0002 (tablas `user`/`session`/`account`/`verification`) con email/contraseña y los plugins `bearer()` y openAPI. `close()` cierra el cliente postgres del paquete.

- **Costura de inyección:** `createApp(config, { auth })` recibe la instancia como dependencia opcional. Cuando está presente, monta `app.on(["POST", "GET"], "/api/auth/*", auth.handler)` **después** de la cadena de middleware (requestId → jsonLogger → metrics → secureHeaders → cors → bodyLimit → timeout → compress) e inyecta el middleware de sesión; las rutas leen `c.get("user")` y `c.get("session")` (`null` sin sesión).
- **Sesión y credenciales:** cookies `HttpOnly`, `SameSite=Lax` y `Secure` bajo HTTPS; tokens bearer con el plugin `bearer()`. El esquema OpenAPI 3.1.1 del subsistema se expone como fuente "Auth" en Scalar `/docs`.
- **Política de orígenes:** los orígenes de cada petición se validan contra el origen de `API_BASE_URL` y la lista `TRUSTED_ORIGINS`; los ajenos se rechazan (`403 INVALID_ORIGIN`).
- **Límites de capas:** `packages/auth` es la única excepción de `packages/*` que importa Hono (solo tipos) y better-auth; `packages/auth-client` (cliente browser-safe) solo importa better-auth y nunca Hono ni Bun. Los `modules/*` no importan `@consulting/auth` ni `@consulting/auth-client`.
- **Autenticación ≠ autorización:** la autenticación responde a *quién eres*; la autorización (roles, catálogo de permisos y políticas) es una preocupación separada, descrita abajo.

## Autorización y auditoría

La autorización responde a *qué puedes hacer*: los roles de Better Auth son identidad, no política de negocio. La decisión de permisos se aplica siempre en el backend; ocultar botones en el frontend es solo UX.

- **Núcleo puro (`packages/authorization`, `@consulting/authorization`):** catálogo explícito `PERMISSIONS` con 9 permisos `request.*` (create/read/update/assign/review/approve/reject/export/delete, sin wildcards), roles `admin`/`reviewer`/`member` con la tabla de concesiones `ROLE_PERMISSIONS`, `authorize(actor, permission)` deny-by-default (roles desconocidos se ignoran; sin roles → `false`) que lanza `AuthorizationError`, y funciones de política ABAC explícitas en `policy.ts` (`canUpdateRequest` owner-or-draft, `canApproveRequest` submitted + separación de funciones, `canDeleteRequest`). `PERMISSION_MATRIX` y `rolesForPermission` se calculan desde las concesiones de roles, con tests que prueban que ningún permiso queda huérfano.
- **Enforcement HTTP (`apps/api`):** middleware `requirePermission(permission, resolveRoles)` — sin sesión → `401 UNAUTHORIZED`; `authorize()` falso → `403 FORBIDDEN` (códigos nuevos en `packages/core/src/problem.ts`); la costura `createApp(config, { auth, getRoles })` recibe el resolvedor de roles, con default `async () => []` (deny by default). Rutas demo: `GET /api/v1/authorization/protected` (`request.read`) y `GET /api/v1/authorization/admin` (`request.delete`, solo admin).
- **Auditoría append-only (`packages/audit`, `@consulting/audit`):** tabla `audit_log` (migración 0003) con id/actor_user_id/action/resource_type/resource_id/outcome/metadata jsonb/created_at e índices sobre `created_at` y `resource_type`; el trigger `audit_log_append_only` + la función `reject_audit_log_mutation()` rechazan UPDATE/DELETE a nivel de base de datos (el invariante sobrevive a bugs de la aplicación). `createAuditLogger(db)` expone solo `record(input)` y `list({ limit? })` (más recientes primero, default 100, tope 1000) — sin API de borrado.
- **Límites de capas:** `packages/authorization` es 100% puro (sin dependencias de runtime); `packages/audit` puede importar drizzle-orm y postgres pero no Hono ni Bun ni better-auth. La decisión de permisos vive en la capa http vía `requirePermission`, nunca dentro de repositorios.

## Multi-tenancy

El perfil multi-tenant responde a *de qué organización eres miembro y qué puedes hacer en ella*: modelo **shared schema** — una sola base de datos, filas por tenant con `organization_id`, repositorios que siempre acotan por tenant. Ver ADR-0007.

- **Cluster `modules/organizations`** (un solo módulo por cluster): organizaciones, membresías e invitaciones con la tríada `domain ← application ← http` y la migración 0004 (cascadas FK, unicidad, expiración y uso único de invitaciones).
- **Roles de organización predefinidos** como columna `membership.role` (owner/admin/auditor/member); propiedad con un único owner (guard del último owner). Sin tablas dinámicas de roles (diferido).
- **Resolución de tenant:** cabecera `x-organization-id` + `TenantContext` + `tenancy-service` (`resolveTenantContext`); el middleware de tenant resuelve el contexto antes de cada handler tenant-scoped. Organizaciones desconocidas → 404; suspendidas o sin membresía activa → 403; la existencia de otros tenants nunca se filtra.
- **Repositorios tenant-scoped:** búsquedas de membresía/invitación con `{ organizationId, id }`; las invitaciones se resuelven por hash global del token (nunca por id desnudo); tests IDOR prueban el rechazo del acceso cross-tenant.
- **Ciclo de vida:** crear (slug único), invitar (token de un solo uso, restricciones de rol), aceptar (expiración + no reutilizable), transferir propiedad (el owner anterior pasa a admin), suspender (los miembros pierden acceso), eliminar miembro (el último owner no puede eliminarse) y borrar con confirmación fuerte (`confirm=true`, cascada de membresías e invitaciones).
- **Auditoría por tenant:** la capa http registra cada éxito del ciclo de vida vía `createOrganizationAudit` (`modules/organizations`) sobre `packages/audit` — `resourceType: "organization"`, `resourceId: <organizationId>`, actor y outcome; la auditoría es best-effort y nunca rompe la operación de negocio.
- **Límites de capas:** el módulo usa tipado estructural para la sesión (sin importar `@consulting/auth`); `modules/organizations` puede importar `@consulting/audit` (tipos y API de registro) desde la capa http/application.

## Integraciones

El perfil de integraciones responde a *cómo se comunican los efectos de dominio con el mundo exterior de forma fiable*: outbox transaccional, cola de jobs, API keys por organización y webhooks firmados. Ver ADR-0008.

- **Outbox transaccional:** los eventos de dominio se emiten **dentro** de la misma transacción que la escritura de negocio (`outbox_events`, migración 0005, dedupe por `event_id`); un worker los entrega de forma fiable. Si el envío falla, el dato ya está persistido y el worker reintenta.
- **JobQueue (`modules/jobs`):** tabla `jobs` (migración 0006) con adaptador PostgreSQL para producción y adaptador en memoria para tests; el outbox worker reintenta con backoff exponencial, pasa a dead-letter tras 5 intentos y permite reproceso controlado. El worker standalone (`bun run worker`, o perfil compose `worker`) tiene shutdown graceful sobre SIGTERM/SIGINT.
- **API keys por organización:** almacenamiento solo-hash (sha256), secreto mostrado una sola vez al crear, expiración/revocación y autenticación bearer (la cookie de sesión tiene precedencia). Viven en `modules/organizations` (migración 0007).
- **Webhooks salientes:** entregas firmadas con HMAC (`x-webhook-signature`) con timestamp, id del evento e `idempotency-key`; payloads redactados, reintentos exponenciales e historial de entregas (migración 0008). El secreto de firma se guarda en texto plano por diseño (`webhook_endpoints.secret`) y nunca se devuelve en respuestas.
- **Webhooks entrantes:** ruta pública `POST /api/v1/webhooks/incoming/:provider` que verifica la firma HMAC **antes** de parsear el cuerpo, dentro de una ventana de frescura de 5 minutos; deduplica por (provider, event id) a nivel de base de datos (migración 0009) y encola el procesamiento de forma asíncrona. El router se monta sin la cadena de sesión/tenant: la firma ES la autenticación.

## Archivos

Los archivos son **referencias, nunca blobs**: la tabla `files` (migración 0010) guarda solo metadatos con claves de almacenamiento generadas por el servidor (`<orgId>/<uuid>/<name>`), hash sha256, allowlist de MIME (png/jpeg/webp/pdf/txt/json) y tope de 10 MiB; tenant-scoped. Ver ADR-0009.

- **Abstracción de almacenamiento:** la interfaz `FileStorage` tiene adaptadores en memoria (tests) y filesystem local (dev); S3/R2/MinIO son drop-in posteriores (el wiring queda a cargo del proyecto que lo consuma).
- **URLs firmadas:** los tokens de descarga se firman con HMAC (payload + expiración, verificación timing-safe); la ruta `GET /api/v1/files/download?token` es pública porque el token firmado ES la autorización y su `organizationId` acota la búsqueda. URLs frescas a petición (1 h por defecto, tope 24 h) y `downloadUrl` de un solo uso al subir.
- **Soft delete:** el borrado es lógico únicamente (borrado físico y job de retención diferidos); upload/download/soft-delete/list usan un `MembershipGuard` inyectado (construido desde el servicio de tenancy de organizaciones).

## Notificaciones

`modules/notifications` entrega correos con plantillas versionadas sin acoplarse a un proveedor: interfaces `Mailer`/`NotificationChannel`/`TemplateRenderer` con implementaciones de sustitución (stub SMTP fail-fast, log-mailer en dev, noop en tests). Ver ADR-0009.

- **Plantillas:** versionadas code-first con fallback de locale es (exacto → es → primera disponible).
- **Dedupe:** ledger `sent_mails` (migración 0011) con dedupe por clave única y envío asíncrono vía la JobQueue (el worker re-verifica el dedupe y relanza `MailerUnavailableError` para los reintentos).
- **Privacidad:** los logs nunca incluyen cuerpos de correo (solo to/template/dedupe/subject).

## Generador

`generator/` es tooling fuera de los workspaces de runtime. Su catálogo de 12 features y sus perfiles (`minimal`, `data-api`, `authenticated`, `multi-tenant`, `platform`) permiten crear proyectos con **poda física**, no con feature flags: los proyectos generados excluyen físicamente las features no seleccionadas. El perfil `platform` añade observabilidad a `multi-tenant`; `dynamicRoles` permanece diferido por su conflicto con `authorization`. Ver ADR-0010.

```bash
bun run generator:validate -- --profile=minimal
bun run create:project -- --profile=authenticated --out=../my-api
bun run add:feature -- --feature=multitenancy --project=../my-api --with-requires
bun run create:module -- --name=requests --scope=tenant --crud --events --audit --out=../my-api/modules
```

- `create:project` elimina físicamente módulos, paquetes, migraciones, snapshots y tests de aplicación no seleccionados, reescribe el journal y deja `GENERATED.md`.
- `add:feature` calcula requisitos transitivos, acepta `multitenancy` como alias de `tenancy`, protege archivos custom mediante marcadores y escribe `FEATURE_PLAN.md`. Al añadir tenancy muestra una advertencia y un plan de migración para revisión; nunca cambia datos ni ejecuta ese plan. Los destinos no vacíos y los archivos protegidos fallan de forma segura; `--force` hace explícita la recreación o sobrescritura.
- **Instalación:** los proyectos generados requieren `bun install`; el generador no edita `bun.lock`. El wiring de proveedores (S3/R2/MinIO, SMTP) queda a cargo de cada proyecto generado.

## SDK y kits frontend

`packages/sdk` (`@consulting/sdk`) es un **SDK TypeScript agnóstico de framework** para consumir la API desde web, móvil y desktop, con kits de adaptación opcionales. La API sigue siendo la única frontera backend: las decisiones de seguridad viven en el servidor y el SDK solo transporta credenciales y cabeceras. Ver ADR-0011.

- **Núcleo:** cliente con `fetch` estándar inyectable, auth por cookie y bearer, cabecera de tenant `x-organization-id` (override por petición), respuestas JSON/204/FormData y errores problem+json acotados (`ApiClientError`, RFC 9457); recursos tipados para auth, organizations, apiKeys, files y webhooks. Sin dependencias de runtime: no importa React, Next, TanStack, Tauri, Node ni Bun.
- **Kit TanStack Query (`src/tanstack.ts`):** query keys, options e invalidaciones estables estructuralmente compatibles con v5 (factories de session/organizations/organizationContext/files/webhooks/apiKeys); los consumidores las envuelven con su `@tanstack/react-query`.
- **Kit Next.js App Router (`src/next.ts`):** cliente de servidor que reenvía cookies explícitamente (sin importar `next/headers`), datos sensibles con `cache: no-store` por defecto (con `revalidate`/tags intencionales) y cliente de navegador con `credentials: "include"`. Sin rutas API duplicadas ni secretos en `localStorage`.
- **Kit móvil (`src/mobile.ts`):** sesión bearer sobre un almacén seguro inyectado (Keychain/Keystore/SecureStore), refresh single-flight, `credentials: "omit"`, idempotency keys y helper de subida multipart.
- **Kit offline (`src/offline.ts`):** cola durable de mutaciones (store en memoria para tests), reintento exponencial acotado con jitter, cabeceras de idempotencia, sin logging de payloads y sin timers en background.
- **Kit Tauri (`src/tauri.ts`):** puente de credenciales sobre `invoke` inyectado, callback de auth con el navegador del sistema y validación de scheme; sin secretos en texto plano ni `localStorage`.
- **Ejemplos:** `integrations/` contiene proyectos de ejemplo (tanstack-query, next-app-router, ignite-react-native, tauri); no se añaden manifests de frontend al starter.
- **Límites:** `packages/sdk` no tiene dependencias de runtime; los consumidores inyectan `fetch`, almacenes seguros y bridges. El SDK queda fuera de los perfiles de runtime del generador: los proyectos generados lo podan hasta que una feature frontend futura lo seleccione. Los kits n8n y Python quedan fuera del alcance.

## Operación

- **Métricas:** registry sin dependencias en `packages/core/src/metrics.ts` (counters/gauges/histograms con exposición en texto Prometheus `text/plain; version=0.0.4`); middleware `apps/api/src/http/metrics.ts` que emite `http_requests_total`, `http_request_duration_seconds` y `http_errors_total` por petición; endpoint `GET /metrics`; contadores del outbox y de entregas de webhooks sin ids en labels (`modules/organizations/src/application/outbox-worker.ts`, `deliver-webhook.ts`). Ver ADR-0012.
- **Logging:** contrato `LogEntry` en `packages/core/src/logger.ts` (timestamp/level/service/environment/version/requestId/route/status/duration + `userId`/`tenantId` seudonimizados y `traceId` opcional); `apps/api/src/http/logger.ts` nunca loguea cuerpos, correos ni cabeceras.
- **Tracing:** contrato desacoplado `Tracer`/`Span` con `createNoopTracer()` en `packages/core/src/tracer.ts`; sin dependencia de OpenTelemetry — un adaptador OTel es un drop-in futuro tras el contrato.
- **Load test reproducible:** `bun scripts/load-test.ts --duration=10 --concurrency=20` (Bun only, sin dependencias nuevas); guía en [`load-test.md`](load-test.md) y resultados en [`load-test-results.md`](load-test-results.md) (0 errores; ~190-250 req/s a 20 workers en localhost; p95 informativo, no un gate).
- **Docker:** imagen multi-stage sobre `oven/bun:1.3.14-slim` que instala el workspace completo con `--frozen-lockfile`, usuario no-root `bun`, labels OCI versionables (`IMAGE_VERSION` default 0.10.1, `IMAGE_SOURCE`), `STOPSIGNAL SIGTERM` y `APP_VERSION` desde el build; `.dockerignore` endurecido. Perfiles compose: `core` (API), `database` (postgres), `worker` (outbox worker). Los perfiles redis/storage/observability se omiten a propósito: sin servicios sin implementación (puntos de extensión en ADR-0008/ADR-0009).
- **Backup/restore:** `scripts/db/backup.ts` (pg_dump custom, contraseña solo por `PGPASSWORD`, logs enmascarados) y `scripts/db/restore.ts` (`--file` + `--force` destructivo); tests reales backup→validate→restore contra una DB scratch y el runbook [`backup-restore.md`](backup-restore.md) (rotación, drill de verificación, RPO/RTO). La automatización por cron queda diferida: hoy es runbook + scripts.
- **Modelo de amenazas:** [`threat-model.md`](threat-model.md) — amenazas con evidencia `archivo:línea` de las mitigaciones actuales, controles obligatorios, política de soporte administrativo (sin superficie hoy) y tratamiento de datos personales, con remediación priorizada.

## Modelo de errores y contratos

- Errores: RFC 9457 (`application/problem+json`) con `code` estable, `requestId` e `instance`; un único normalizador (`onError`/`notFound`) mapea status → código; nunca se filtran stack traces ni internos. Ver ADR-0003.
- Contratos: schemas zod en `packages/contracts` (base) y co-localizados en cada módulo; alimentan tipos, el documento OpenAPI 3.1 y los tests (triple fuente). Ver ADR-0002.

## Decisiones (ADR)

| ADR | Decisión |
|---|---|
| [0001-toolchain](decisions/0001-toolchain.md) | Toolchain: Bun, TypeScript 7.0.2 (fallback 5.9.3), Biome, pins exactos |
| [0002-openapi-hono-openapi](decisions/0002-openapi-hono-openapi.md) | OpenAPI 3.1 generado desde schemas zod (triple fuente) |
| [0003-error-model-problem-details](decisions/0003-error-model-problem-details.md) | Modelo de errores RFC 9457 |
| [0004-version-pinning](decisions/0004-version-pinning.md) | Versiones exactas y lockfile commitado |
| [0005-persistence-drizzle](decisions/0005-persistence-drizzle.md) | PostgreSQL 17 + Drizzle ORM + migraciones SQL commitadas |
| [0006-authorization-deny-by-default](decisions/0006-authorization-deny-by-default.md) | Autorización deny-by-default y auditoría append-only |
| [0007-multi-tenancy-shared-schema](decisions/0007-multi-tenancy-shared-schema.md) | Multi-tenancy shared schema |
| [0008-integrations-outbox-webhooks](decisions/0008-integrations-outbox-webhooks.md) | Outbox transaccional, cola de jobs, API keys y webhooks |
| [0009-files-notifications](decisions/0009-files-notifications.md) | Archivos como referencias y notificaciones con plantillas |
| [0010-generator-profiles-features](decisions/0010-generator-profiles-features.md) | Generador declarativo con poda física |
| [0011-frontend-integration-kits](decisions/0011-frontend-integration-kits.md) | SDK agnóstico y kits de integración frontend |
| [0012-hardening-observability](decisions/0012-hardening-observability.md) | Hardening: observabilidad, load test, Docker y backup/restore |
