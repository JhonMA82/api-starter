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

## Integraciones (Fase 6)

El perfil de integraciones responde a *cómo se comunican los efectos de
dominio con el mundo exterior de forma fiable* (spec §13.2, §14.1-14.6,
§10.x): outbox transaccional, cola de jobs, API keys por organización y
webhooks firmados. Ver ADR-0008.

- **Outbox transaccional + eventos de dominio** (§14.3): tabla
  `outbox_events` (migración 0005) con status
  pending/processing/succeeded/failed/dead_letter, `attempts`,
  `max_attempts` (5), `last_error` y `next_attempt_at`; `OutboxRepository`
  (append con dedupe por `event_id`, `findPendingDue`,
  `markProcessing`/`markSucceeded`/`markFailed` con backoff exponencial,
  `reprocess`, `listByStatus`); eventos de dominio (organization.created,
  member.invited, invitation.accepted, ownership.transferred,
  organization.suspended, organization.deleted, member.removed,
  api_key.created, api_key.revoked); `create-organization` emite
  `organization.created` **dentro** de la misma transacción UnitOfWork
  (§9.5).
- **JobQueue + worker** (§14.4): `modules/jobs` con la tabla `jobs`
  (migración 0006), la interfaz `JobQueue` (enqueue/schedule/cancel), un
  adaptador PostgreSQL y un adaptador en memoria (solo tests); outbox worker
  (poll, handlers por evento, reintentos con backoff exponencial
  `1s · 2^attempts` con tope 1h, dead-letter tras `max_attempts`, reproceso
  controlado).
- **API keys** (§10.x, §13.2): tabla `api_keys` (migración 0007) con
  almacenamiento solo-hash (sha256), prefijo de 8 caracteres, `expires_at`,
  `revoked_at`, `last_used_at`; tenant-scoped con cascada al borrar la
  organización; casos de uso create/revoke/verify (owner/admin, secreto de
  un solo uso) y middleware bearer de api-key (la cookie de sesión tiene
  precedencia); eventos `api_key.created`/`api_key.revoked` + entradas de
  auditoría.
- **Webhooks salientes** (§14.5): tablas `webhook_endpoints` +
  `webhook_deliveries` (migración 0008); casos de uso
  register/rotate/list/toggle (owner/admin, secreto de un solo uso al crear
  y al rotar); entregas firmadas con HMAC — cabeceras
  `x-webhook-signature: sha256=<hex>` sobre `timestamp + "." + body`,
  `x-webhook-timestamp` (segundos unix), `x-webhook-event-id`,
  `x-webhook-event-type` e `idempotency-key`; payloads redactados (strip
  recursivo de claves password/secret/token/authorization/api-key);
  reintentos con backoff exponencial; historial de entregas; fan-out del
  handler del outbox a los endpoints suscritos. El secreto del endpoint se
  guarda en texto plano en `webhook_endpoints.secret` — credencial de
  integración del lado del servidor necesaria para firmar, nunca devuelta en
  respuestas (decisión documentada).
- **Webhooks entrantes** (§14.6): helper compartido de firma HMAC
  (verificación timing-safe, ventana de 5 minutos); tabla
  `incoming_webhooks` (migración 0009) con unicidad `(provider, event_id)`
  a nivel de base de datos; caso de uso receive (verificar firma **antes**
  de parsear, payloads almacenados redactados, cuerpo crudo conservado como
  `{ raw }` si no parsea, encolar procesamiento asíncrono vía JobQueue,
  auditoría `webhook.received`); ruta pública
  `POST /api/v1/webhooks/incoming/:provider` — 202 aceptado/duplicado, 401
  firma inválida (nada se almacena), 404 proveedor desconocido (la
  existencia no se revela); secretos de proveedor en un `Map` estático
  (almacén de secretos en DB documentado como mejora futura).

## Archivos y notificaciones (Fase 7)

El perfil de archivos y notificaciones responde a *cómo se almacenan y
sirven archivos de tenant y cómo se envían correos de forma fiable* (spec
§15, §16). Ver ADR-0009.

- **Archivos como referencias, nunca blobs** (§15): `modules/files`
  (`@consulting/module-files`) con la tabla `files` (migración 0010) que
  guarda solo metadatos — PostgreSQL no almacena binarios. Claves de
  almacenamiento generadas por el servidor (`<orgId>/<uuid>/<name>`),
  nombres saneados, hash sha256 del contenido, tope de 10 MiB y allowlist
  de MIME (png/jpeg/webp/pdf/txt/json); tenant-scoped con FK
  `organization_id` en cascada.
- **Abstracción de almacenamiento:** interfaz `FileStorage` con adaptador
  en memoria (tests) y adaptador de filesystem local (dev); un adaptador
  S3/R2/MinIO es un drop-in posterior.
- **URLs firmadas con HMAC** (§15): los tokens de descarga son
  `<base64url(JSON {fileId, organizationId, exp})>.<hex(HMAC-SHA256)>` con
  verificación timing-safe que nunca lanza — token expirado/malformado →
  401, archivo borrado/inexistente → 404. La ruta
  `GET /api/v1/files/download?token` es **pública por token**: el token
  firmado ES la autorización; el API nunca sirve subidas desde el proceso.
  URLs frescas a petición (`POST /api/v1/files/:id/url`, default 3600s,
  tope 86400s) y `downloadUrl` de un solo uso en la subida (201).
- **Casos de uso** (§15): upload/download/soft-delete/list con un
  `MembershipGuard` inyectado (conectado a la tenancy de organizaciones en
  `apps/api`). El borrado es soft-delete únicamente; el borrado físico y el
  job de retención quedan diferidos.
- **Notificaciones por correo** (§16): `modules/notifications`
  (`@consulting/module-notifications`) con las interfaces
  `Mailer`/`NotificationChannel`/`TemplateRenderer` sin acoplamiento a
  proveedor — el stub SMTP lanza fail-fast ("transport not implemented"),
  log-mailer para previsualización en dev y noop para tests. Plantillas
  versionadas code-first (`invitation.v1` es+en, `welcome.v1` solo es) con
  fallback es por defecto (locale exacto → es → primera disponible) y
  sustitución `{var}`.
- **Dedupe y envío asíncrono** (§16): ledger `sent_mails` (migración 0011)
  con `dedupe_key` único y `onConflictDoNothing`; el servicio de envío
  detecta duplicados → renderiza → encola el job `notification.send` vía
  la JobQueue (o envío síncrono); el worker re-verifica el dedupe antes de
  enviar y relanza `MailerUnavailableError` para que la política de
  reintentos de los jobs la gestione. Los logs **nunca** incluyen cuerpos
  (solo to/template/dedupe/subject).

## Generador (Fase 8)

El generador es tooling independiente para crear proyectos con un conjunto de
capacidades explícito y evolucionarlos sin esconder dependencias detrás de
feature flags. Ver [ADR-0010](decisions/0010-generator-profiles-features.md).

- **Catálogo y perfiles:** `generator/src/features.ts` y
  `generator/src/profiles.ts` son la fuente TypeScript; los manifiestos
  versionados `generator/features.json` y `generator/profiles.json` se
  sincronizan con `sync-manifests.ts`. El catálogo contiene 12 features:
  `persistence`, `auth`, `authorization`, `tenancy`, `audit`, `apiKeys`,
  `jobs`, `webhooks`, `files`, `notifications`, `observability` y
  `dynamicRoles`. Los perfiles son `minimal` (ninguna), `data-api`
  (`persistence`), `authenticated` (`persistence` + `auth` +
  `authorization`), `multi-tenant` (añade tenancy, audit, API keys, jobs,
  webhooks, files y notifications) y `platform` (multi-tenant +
  `observability`; no incluye `dynamicRoles`). `dynamicRoles` sigue diferido
  y es incompatible con `authorization`.
- **Validación:** `generator:validate` rechaza features o perfiles
  desconocidos, ids duplicados, requisitos ausentes y conflictos declarados
  mediante `excludedBy`. La graph de requisitos incluye, entre otras,
  `authorization → auth`, `tenancy → auth`, `audit → persistence`,
  `apiKeys → tenancy`, `jobs → persistence`, `webhooks → tenancy + jobs`,
  `files → tenancy`, `notifications → jobs` y `dynamicRoles → tenancy`.
- **`create:project`:** resuelve un perfil y poda físicamente módulos,
  paquetes, migraciones, snapshots y tests de aplicación que no pertenecen a
  las features seleccionadas. También reescribe dependencias, configuración
  de Drizzle y entorno, filtra y renumera `_journal.json`, elige variantes de
  las plantillas de app/rutas y escribe `GENERATED.md`. La copia excluye
  `.git`, `node_modules`, `.codegraph`, `.atl`, `generator` y el archivo de
  especificación externo.
- **Plantillas:** las variantes de `app.ts` y `routes.ts` son copias manuales
  mantenidas para cada composición; llevan un marcador del generador. No se
  resuelven en el typecheck del paquete standalone, por lo que se cubren con
  scans de imports y pruebas e2e.
- **`create:module`:** genera scaffolds con scope `global`, `user` o `tenant`;
  `--crud`, `--events` y `--audit` controlan CRUD, eventos de dominio y el
  seam de auditoría best-effort. Los scopes de usuario y tenant propagan
  `userId` u `organizationId`.
- **`add:feature`:** lee `GENERATED.md`, acepta `multitenancy` como alias de
  `tenancy`, calcula el cierre transitivo con `--with-requires`, copia
  recursos físicos y reescribe dependencias, configuración, entorno y el
  journal. Protege archivos custom o sin marcador salvo con `--force`, genera
  `FEATURE_PLAN.md` y hace no-op si la feature ya está habilitada. Al añadir
  tenancy muestra una advertencia y un plan manual de migración (tablas,
  `organization_id`, backfill, índices/constraints y pruebas IDOR/aislamiento);
  nunca cambia datos automáticamente.
- **Instalación:** los proyectos generados requieren `bun install`; el
  generador no edita `bun.lock`. La integración de proveedores como S3/R2/
  MinIO o SMTP queda para el wiring de cada proyecto.

## Kits de integración frontend (Fase 9)

La Fase 9 entrega un **SDK TypeScript agnóstico de framework**
(`packages/sdk`, `@consulting/sdk`) con kits de integración opcionales para
web, móvil y desktop. La API sigue siendo la única frontera backend: las
decisiones de seguridad viven en el servidor y el SDK solo transporta
credenciales y cabeceras. Ver
[ADR-0011](decisions/0011-frontend-integration-kits.md).

- **Núcleo del SDK:** cliente con `fetch` estándar inyectable, auth por cookie
  y bearer, cabecera de tenant `x-organization-id` (con override por petición),
  respuestas JSON/204/FormData y errores problem+json acotados
  (`ApiClientError`, RFC 9457); recursos tipados para auth, organizations,
  apiKeys, files y webhooks. Sin dependencias de runtime: no importa React,
  Next, TanStack, Tauri, Node ni Bun.
- **Kit TanStack Query (`src/tanstack.ts`):** query keys, options e
  invalidaciones estables estructuralmente compatibles con TanStack Query v5
  (factories de session/organizations/organizationContext/files/webhooks/
  apiKeys); los consumidores las envuelven con su `@tanstack/react-query`
  instalado.
- **Kit Next.js App Router (`src/next.ts`):** cliente de servidor que reenvía
  cookies explícitamente (sin importar `next/headers`), datos sensibles con
  `cache: no-store` por defecto (con `revalidate`/tags intencionales) y
  cliente de navegador con `credentials: "include"` y query tags estables.
  Sin rutas API duplicadas ni secretos en `localStorage`.
- **Kit móvil (`src/mobile.ts`):** sesión bearer sobre un almacén seguro
  inyectado (Keychain/Keystore/SecureStore), refresh single-flight,
  `credentials: "omit"`, idempotency keys y helper de subida multipart.
- **Kit offline (`src/offline.ts`):** cola durable de mutaciones (store en
  memoria para tests), reintento exponencial acotado con jitter, cabeceras de
  idempotencia, sin logging de payloads y sin timers en background.
- **Kit Tauri (`src/tauri.ts`):** puente de credenciales sobre `invoke`
  inyectado, callback de auth con el navegador del sistema y validación de
  scheme; sin secretos en texto plano ni `localStorage`.
- **Ejemplos:** `integrations/` contiene proyectos de ejemplo (tanstack-query,
  next-app-router, ignite-react-native, tauri); no se añaden manifests de
  frontend al starter.
- **Reglas de límites:** `packages/sdk` no tiene dependencias de runtime y los
  consumidores inyectan `fetch`, almacenes seguros y bridges; la seguridad
  permanece en la API, nunca solo en loaders del frontend. El SDK queda fuera
  de los perfiles de runtime del generador: los proyectos generados lo podan
  hasta que una feature frontend futura lo seleccione.

## Hardening (Fase 10)

La Fase 10 cierra la preparación operativa del starter (spec §20, §22, §23,
§31) sin acoplarse a proveedores. Ver
[ADR-0012](decisions/0012-hardening-observability.md).

- **Modelo de amenazas (spec §20):** `docs/threat-model.md` documenta las
  amenazas del §20.1 con evidencia `archivo:línea` de las mitigaciones
  actuales, la tabla de controles obligatorios del §20.2, la política de
  soporte administrativo del §20.3 (sin superficie hoy; disabled by default
  como requisito futuro) y el tratamiento de datos personales del §20.4, con
  un orden de remediación priorizado. El único cambio de código del WU1 alineó
  el tope de subida de 10 MiB con el límite global de payload de 1 MiB
  (`apps/api/src/app.ts`, `modules/files/src/http/file.routes.ts`).
- **Métricas (spec §22.1/§22.2):** registry sin dependencias en
  `packages/core/src/metrics.ts` (counters/gauges/histograms con exposición
  en texto Prometheus `text/plain; version=0.0.4`); middleware
  `apps/api/src/http/metrics.ts` que emite `http_requests_total`,
  `http_request_duration_seconds` y `http_errors_total` por petición; endpoint
  `GET /metrics`; contadores del outbox y de entregas de webhooks sin ids en
  labels (`modules/organizations/src/application/outbox-worker.ts`,
  `deliver-webhook.ts`).
- **Logging (spec §22):** contrato `LogEntry` en `packages/core/src/logger.ts`
  (timestamp/level/service/environment/version/requestId/route/status/
  duration + `userId`/`tenantId` seudonimizados y `traceId` opcional);
  `apps/api/src/http/logger.ts` nunca loguea cuerpos, correos ni cabeceras.
- **Tracer (spec §22.3):** contrato desacoplado `Tracer`/`Span` con
  `createNoopTracer()` en `packages/core/src/tracer.ts`; sin dependencia de
  OpenTelemetry — un adaptador OTel es un drop-in futuro tras el contrato.
- **Load test reproducible (spec §23):** `scripts/load-test.ts` (Bun only, sin
  dependencias nuevas) con opciones de duración/concurrencia/rate/ruta y
  resumen JSON; `docs/load-test.md` (ejecución, escenarios, umbrales, CI) y
  `docs/load-test-results.md` (0 errores, ~190-250 req/s a 20 workers en
  localhost; p95 informativo, no un gate).
- **Docker y compose (spec §23.1/§23.2/§23.4):** imagen multi-stage sobre
  `oven/bun:1.3.14-slim` que instala el **workspace completo** con
  `--frozen-lockfile`, usuario no-root `bun`, labels OCI versionables
  (`IMAGE_VERSION` default 0.10.0, `IMAGE_SOURCE`), `STOPSIGNAL SIGTERM` y
  `APP_VERSION` desde el build; `.dockerignore` endurecido (dumps, tooling
  local y coverage fuera del contexto). Perfil compose `worker` para
  `scripts/worker.ts` (outbox worker standalone con shutdown graceful); los
  perfiles redis/storage/observability se omiten a propósito (spec §23.2: sin
  servicios sin implementación), con sus puntos de extensión en
  ADR-0008/ADR-0009.
- **Backup/restore probados (spec §20.2):** `scripts/db/backup.ts` (pg_dump
  custom, contraseña solo por `PGPASSWORD`, logs enmascarados) y
  `scripts/db/restore.ts` (`--file` + `--force` destructivo); tests reales
  backup→validate→restore contra una DB scratch y el runbook
  `docs/backup-restore.md` (rotación, drill de verificación, RPO/RTO). La
  automatización por cron queda diferida: hoy es runbook + scripts.

## Resumen de fases (roadmap completo a través de Fase 10)

- **Fase 0+1 (completada):** fundación — registros, ADRs, núcleo HTTP con rutas base, OpenAPI 3.1 + Scalar, módulo de ejemplo, Docker y CI de 5 jobs.
- **Fase 2 (completada, persistencia):** PostgreSQL 17 + Drizzle ORM sobre postgres.js, migraciones SQL commitadas bajo `migrations/`, módulo `notes` de referencia con tests de DB reales, scripts `db:*` con podman, perfil `database` en Docker Compose y CI de 8 jobs. Ver ADR-0005 y `docs/migrations-runbook.md`.
- **Fase 3 (completada, autenticación):** Better Auth 1.6.25 aislado en `packages/auth` (`@consulting/auth`) con adaptador drizzle (migración 0002: `user`/`session`/`account`/`verification`), email/contraseña y plugins `bearer()`/openAPI; cliente browser-safe `packages/auth-client`; montaje de `/api/auth/*` y middleware de sesión vía la costura `createApp(config, { auth })`; tests de DB reales y extensión de CI. Ver [Autenticación (Fase 3)](#autenticación-fase-3).
- **Fase 4 (completada, autorización single-tenant):** catálogo explícito de permisos `request.*`, roles admin/reviewer/member y políticas ABAC en `packages/authorization` (deny by default); enforcement HTTP con `requirePermission` y la costura `getRoles` (códigos `401 UNAUTHORIZED` / `403 FORBIDDEN`, rutas demo `/api/v1/authorization/*`); auditoría append-only `audit_log` (migración 0003) con trigger de base de datos en `packages/audit`. Ver [Autorización (Fase 4)](#autorización-fase-4).
- **Fase 5 (completada, multi-tenancy):** `modules/organizations` (organizaciones/membresías/invitaciones, migración 0004) con shared schema; roles de org predefinidos (owner/admin/auditor/member); `TenantContext` + flujo de resolución con `x-organization-id`; repositorios tenant-scoped con protección IDOR; ciclo de vida completo (crear/invitar/aceptar/transferir/suspender/eliminar miembro/borrar con confirmación) e invariantes (§11.8); auditoría por tenant sobre `packages/audit` y ADR-0007. Ver [Multi-tenancy (Fase 5)](#multi-tenancy-fase-5).
- **Fase 6 (completada, integraciones):** outbox transaccional + eventos de dominio (migración 0005), `modules/jobs` con la JobQueue (adaptador PostgreSQL; in-memory solo para tests) + outbox worker con backoff/dead-letter/reproceso (migración 0006), API keys por organización con almacenamiento solo-hash (migración 0007), webhooks salientes firmados con HMAC (migración 0008) y webhooks entrantes verify-first con dedupe por provider+event id (migración 0009). Ver [Integraciones (Fase 6)](#integraciones-fase-6) y ADR-0008.
- **Fase 7 (completada, archivos y notificaciones):** `modules/files` con la abstracción `FileStorage` (adaptadores en memoria y filesystem local), tabla `files` de solo referencias (migración 0010, tenant-scoped, sha256, allowlist de MIME, tope 10 MiB), URLs de descarga firmadas con HMAC (ruta pública por token) y soft-delete con `MembershipGuard` inyectado; `modules/notifications` con interfaces `Mailer`/`NotificationChannel`/`TemplateRenderer` (sin acoplamiento a proveedor), plantillas versionadas con fallback es, ledger de dedupe `sent_mails` (migración 0011) y envío asíncrono vía JobQueue. Ver [Archivos y notificaciones (Fase 7)](#archivos-y-notificaciones-fase-7) y ADR-0009.
- **Fase 8 (completada, generador):** catálogo declarativo de features y perfiles, validación, `create:project` con poda física y cirugía del journal, `create:module` con scopes y flags, y `add:feature` con cierre de requisitos, alias, protección por marcadores y plan manual para tenancy. Ver [Generador (Fase 8)](#generador-fase-8) y ADR-0010.
- **Fase 9 (completada, kits de integración frontend):** SDK TypeScript agnóstico (`packages/sdk`) con kits para TanStack Query v5, Next.js App Router, móvil (Ignite/React Native) y desktop (Tauri), cola offline con idempotencia y ejemplos en `integrations/`. Los kits n8n y Python quedan fuera del alcance de esta fase (decisión del usuario) y permanecen como trabajo futuro. Ver [Kits de integración frontend (Fase 9)](#kits-de-integración-frontend-fase-9) y ADR-0011.
- **Fase 10 (completada, hardening):** threat model (`docs/threat-model.md`, spec §20), observabilidad sin acoplamiento de proveedor (registry de métricas + `GET /metrics`, logging seudonimizado, contrato `Tracer`/`Span`), load test reproducible Bun-only (`scripts/load-test.ts` + `docs/load-test*.md`), Docker multi-stage endurecido con el workspace completo y perfil compose `worker`, y backup/restore probados (`scripts/db/backup|restore.ts` + `docs/backup-restore.md`). Roadmap de Fases 0-10 completo; la documentación final (spec §31) cierra con `VALIDATION_REPORT.md` y la consolidación del CHANGELOG `0.10.0`. Ver [Hardening (Fase 10)](#hardening-fase-10) y ADR-0012.
- **Perfil Docker `core`:** solo el servicio `api`. La base de datos vive en el perfil `database` (postgres) y no es un requisito del servidor HTTP.

## Modelo de datos y errores

- Errores: RFC 9457 (`application/problem+json`) con `code` estable, `requestId` e `instance`; un único normalizador (`onError`/`notFound`) mapea status → código. Ver ADR-0003.
- Contratos: schemas zod en `packages/contracts` (base) y co-localizados en cada módulo; alimentan tipos, documento OpenAPI 3.1 y tests (triple fuente). Ver ADR-0002.
