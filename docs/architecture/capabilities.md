# Capabilities

**Audiencia:** desarrolladores del starter y de proyectos generados.
**Objetivo:** qué incluye cada capacidad opcional del catálogo. Las decisiones con contexto completo viven en los [ADR](../decisions/) (inglés). Las operaciones (migraciones, backup, carga, amenazas) viven en [`docs/operations/`](../operations/) y [`docs/security/`](../security/).

## Modelo de errores y contratos (base)

- **Errores:** RFC 9457 (`application/problem+json`) con `code` estable, `requestId` e `instance`; un único normalizador (`onError`/`notFound`) mapea status → código; nunca se filtran stack traces ni internos. Ver ADR-0003.
- **Contratos:** schemas zod en `packages/contracts` (base) y co-localizados en cada módulo; alimentan tipos, el documento OpenAPI 3.1 y los tests (triple fuente). Ver ADR-0002.
- **Configuración:** `packages/config` valida el entorno con zod antes de arrancar (fail-fast). Variables en [reference/environment.md](../reference/environment.md).

## Autenticación

Better Auth 1.6.25 queda aislado en `packages/auth` (`@consulting/auth`): un único export `createAuth(options)` que devuelve `{ handler, sessionMiddleware, getSession, close }`, usando el adaptador drizzle sobre la migración 0002 (tablas `user`/`session`/`account`/`verification`) con email/contraseña y los plugins `bearer()` y openAPI.

- **Sesión y credenciales:** cookies `HttpOnly`, `SameSite=Lax` y `Secure` bajo HTTPS; tokens bearer con el plugin `bearer()`. El esquema OpenAPI del subsistema se expone como fuente "Auth" en Scalar `/docs`.
- **Política de orígenes:** los orígenes se validan contra el de `API_BASE_URL` y la lista `TRUSTED_ORIGINS`; los ajenos se rechazan (`403 INVALID_ORIGIN`).
- **Autenticación ≠ autorización:** la autenticación responde a *quién eres*; la autorización es una preocupación separada, descrita abajo.

## Autorización y auditoría

La autorización responde a *qué puedes hacer*: los roles de Better Auth son identidad, no política de negocio. La decisión de permisos se aplica siempre en el backend; ocultar botones en el frontend es solo UX.

- **Núcleo puro (`packages/authorization`):** catálogo explícito `PERMISSIONS` con 9 permisos `request.*` (sin wildcards), roles `admin`/`reviewer`/`member` con la tabla de concesiones `ROLE_PERMISSIONS`, `authorize(actor, permission)` deny-by-default que lanza `AuthorizationError`, y funciones de política ABAC explícitas en `policy.ts` (`canUpdateRequest` owner-or-draft, `canApproveRequest` submitted + separación de funciones, `canDeleteRequest`). `PERMISSION_MATRIX` y `rolesForPermission` se calculan desde las concesiones, con tests que prueban que ningún permiso queda huérfano.
- **Enforcement HTTP:** middleware `requirePermission(permission, resolveRoles)` — sin sesión → `401 UNAUTHORIZED`; `authorize()` falso → `403 FORBIDDEN`; el resolvedor de roles por defecto es `async () => []` (deny by default). Rutas demo: `GET /api/v1/authorization/protected` (`request.read`) y `GET /api/v1/authorization/admin` (`request.delete`, solo admin).
- **Auditoría append-only (`packages/audit`):** tabla `audit_log` (migración 0003); el trigger `audit_log_append_only` + la función `reject_audit_log_mutation()` rechazan UPDATE/DELETE a nivel de base de datos (el invariante sobrevive a bugs de la aplicación). `createAuditLogger(db)` expone solo `record(input)` y `list({ limit? })` — sin API de borrado.

## Multi-tenancy

El perfil multi-tenant responde a *de qué organización eres miembro y qué puedes hacer en ella*: modelo **shared schema** — una sola base de datos, filas por tenant con `organization_id`, repositorios que siempre acotan por tenant. Ver ADR-0007.

- **Cluster `modules/organizations`:** organizaciones, membresías e invitaciones con la tríada `domain ← application ← http` y la migración 0004 (cascadas FK, unicidad, expiración y uso único de invitaciones).
- **Roles de organización predefinidos** como columna `membership.role` (owner/admin/auditor/member); propiedad con un único owner (guard del último owner).
- **Resolución de tenant:** cabecera `x-organization-id` + `TenantContext` + middleware que resuelve el contexto antes de cada handler tenant-scoped. Organizaciones desconocidas → 404; suspendidas o sin membresía activa → 403; la existencia de otros tenants nunca se filtra.
- **Repositorios tenant-scoped:** búsquedas con `{ organizationId, id }`; las invitaciones se resuelven por hash global del token; tests IDOR prueban el rechazo del acceso cross-tenant.
- **Ciclo de vida:** crear (slug único), invitar (token de un solo uso), aceptar (expiración + no reutilizable), transferir propiedad (el owner anterior pasa a admin), suspender, eliminar miembro (el último owner no puede eliminarse) y borrar con confirmación fuerte (`confirm=true`, cascada).
- **Auditoría por tenant:** cada éxito del ciclo de vida se registra vía `createOrganizationAudit` — best-effort, nunca rompe la operación de negocio.

## Integraciones

Responden a *cómo se comunican los efectos de dominio con el mundo exterior de forma fiable*: outbox transaccional, cola de jobs, API keys por organización y webhooks firmados. Ver ADR-0008.

- **Outbox transaccional:** los eventos de dominio se emiten **dentro** de la misma transacción que la escritura de negocio (`outbox_events`, migración 0005, dedupe por `event_id`); un worker los entrega de forma fiable con reintentos.
- **JobQueue (`modules/jobs`):** tabla `jobs` (migración 0006) con adaptador PostgreSQL para producción e in-memory para tests; backoff exponencial, dead-letter tras 5 intentos y reproceso controlado. El worker standalone (`bun run worker`) tiene shutdown graceful.
- **API keys por organización:** almacenamiento solo-hash (sha256), secreto mostrado una sola vez, expiración/revocación y autenticación bearer (la cookie de sesión tiene precedencia). Viven en `modules/organizations` (migración 0007).
- **Webhooks salientes:** entregas firmadas con HMAC (`x-webhook-signature`) con timestamp, id del evento e `idempotency-key`; payloads redactados, reintentos exponenciales e historial de entregas (migración 0008). El secreto de firma se guarda en texto plano por diseño (`webhook_endpoints.secret`) y nunca se devuelve en respuestas.
- **Webhooks entrantes:** ruta pública `POST /api/v1/webhooks/incoming/:provider` que verifica la firma HMAC **antes** de parsear el cuerpo, en una ventana de frescura de 5 minutos; deduplica por (provider, event id) a nivel de base de datos (migración 0009) y encola el procesamiento de forma asíncrona. Se monta sin la cadena de sesión/tenant: la firma ES la autenticación.

## Archivos

Los archivos son **referencias, nunca blobs**: la tabla `files` (migración 0010) guarda solo metadatos con claves de almacenamiento generadas por el servidor (`<orgId>/<uuid>/<name>`), hash sha256, allowlist de MIME (png/jpeg/webp/pdf/txt/json) y tope de 10 MiB; tenant-scoped. Ver ADR-0009.

- **Abstracción de almacenamiento:** la interfaz `FileStorage` tiene adaptadores en memoria (tests) y filesystem local (dev); S3/R2/MinIO son drop-in posteriores (el wiring queda a cargo del proyecto que lo consuma).
- **URLs firmadas:** tokens de descarga firmados con HMAC (payload + expiración, verificación timing-safe); `GET /api/v1/files/download?token` es pública porque el token firmado ES la autorización y su `organizationId` acota la búsqueda. URLs frescas a petición (1 h por defecto, tope 24 h) y `downloadUrl` de un solo uso al subir.
- **Soft delete:** el borrado es lógico únicamente (borrado físico y job de retención diferidos); el guard de membresía se inyecta desde el servicio de tenancy.

## Notificaciones

`modules/notifications` entrega correos con plantillas versionadas sin acoplarse a un proveedor: interfaces `Mailer`/`NotificationChannel`/`TemplateRenderer` con implementaciones de sustitución (stub SMTP fail-fast, log-mailer en dev, noop en tests). Ver ADR-0009.

- **Plantillas:** versionadas code-first con fallback de locale es (exacto → es → primera disponible).
- **Dedupe:** ledger `sent_mails` (migración 0011) con dedupe por clave única y envío asíncrono vía la JobQueue (el worker re-verifica el dedupe y relanza `MailerUnavailableError` para los reintentos).
- **Privacidad:** los logs nunca incluyen cuerpos de correo (solo to/template/dedupe/subject).

## SDK y kits frontend

`packages/sdk` (`@consulting/sdk`) es un **SDK TypeScript agnóstico de framework** para consumir la API desde web, móvil y desktop, con kits de adaptación opcionales. La API sigue siendo la única frontera backend: las decisiones de seguridad viven en el servidor y el SDK solo transporta credenciales y cabeceras. Ver ADR-0011.

- **Núcleo:** cliente con `fetch` estándar inyectable, auth por cookie y bearer, cabecera de tenant `x-organization-id` (override por petición), respuestas JSON/204/FormData y errores problem+json acotados (`ApiClientError`); recursos tipados para auth, organizations, apiKeys, files y webhooks. Sin dependencias de runtime.
- **Kit TanStack Query (`src/tanstack.ts`):** query keys, options e invalidaciones estables, estructuralmente compatibles con v5.
- **Kit Next.js App Router (`src/next.ts`):** cliente de servidor que reenvía cookies explícitamente, datos sensibles con `cache: no-store` por defecto y cliente de navegador con `credentials: "include"`.
- **Kit móvil (`src/mobile.ts`):** sesión bearer sobre un almacén seguro inyectado (Keychain/Keystore/SecureStore), refresh single-flight, `credentials: "omit"` e idempotency keys.
- **Kit offline (`src/offline.ts`):** cola durable de mutaciones (store en memoria para tests), reintento exponencial acotado con jitter, sin logging de payloads.
- **Kit Tauri (`src/tauri.ts`):** puente de credenciales sobre `invoke` inyectado, callback de auth con el navegador del sistema y validación de scheme.
- **Ejemplos:** `integrations/` contiene proyectos de ejemplo (tanstack-query, next-app-router, ignite-react-native, tauri); no se añaden manifests de frontend al starter.
- **Límites:** sin dependencias de runtime; los consumidores inyectan `fetch`, almacenes seguros y bridges. El SDK queda fuera de los perfiles del generador (los proyectos lo podan hasta que una feature frontend futura lo seleccione).

## Operación

Los aspectos operativos (observabilidad, Docker, backup/restore, load test, modelo de amenazas) tienen documentación propia:

- [operations/migrations.md](../operations/migrations.md) — migraciones de base de datos.
- [operations/backup-and-restore.md](../operations/backup-and-restore.md) — backup y restauración.
- [operations/load-testing.md](../operations/load-testing.md) — prueba de carga reproducible.
- [security/threat-model.md](../security/threat-model.md) — amenazas, controles y prioridades.
