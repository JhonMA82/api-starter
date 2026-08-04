# Modelo de amenazas

Fecha: 3 de agosto de 2026 (Fase 10, WU1 — hardening).

Alcance: el starter (`apps/api`, `packages/*`, `modules/*`, CI, config). Documenta las
amenazas del espec §20.1, el estado de los controles obligatorios §20.2, la política de
soporte administrativo §20.3 y el tratamiento de datos personales §20.4. El generador
(`generator/`) queda fuera del modelo de amenazas de runtime; los proyectos generados
heredan este documento solo si seleccionan las features correspondientes.

Metodología: por cada amenaza se evalúa superficie, probabilidad e impacto, se listan las
mitigaciones existentes con evidencia (`archivo:línea`), el riesgo residual y el estado.
Estados: `mitigada`, `parcialmente mitigada`, `diferida` (con dueño/próximo paso) y
`no aplicable`. Las referencias a código están en inglés por convención del repo.

## Modelo de amenazas

| Amenaza (§20.1) | Superficie | Prob. | Impacto | Mitigaciones actuales | Riesgo residual | Estado |
|---|---|---|---|---|---|---|
| Robo de sesión | `/api/auth/*`, cookies de sesión, bearer tokens | Media | Alto | Cookies `HttpOnly`, `SameSite=Lax`, `Secure` bajo HTTPS (`apps/api/tests/auth.test.ts:74-84, 259-311`); origin check de Better Auth con `trustedOrigins` y `disableOriginCheck: false` (`packages/auth/src/auth.ts:19-27`); sesiones revocables (`revoke-session`, `auth.test.ts:232-239`); secreto mínimo 32 chars (`packages/config/src/env.ts:20`); kits SDK con almacenes seguros inyectados (Fase 9) | Robo del bearer token en almacenes inseguros del cliente; no hay rotación automática de sesiones | Mitigada |
| CSRF | Mutaciones autenticadas por cookie (`/api/v1/*` POST/DELETE) | Baja | Alto | Cookies `SameSite=Lax` bloquean envíos cross-site; origin check en `/api/auth/*` (403 `INVALID_ORIGIN`, `auth.test.ts:270-273`); allowlist CORS niega lecturas cross-origin (`apps/api/src/app.ts:64`, `apps/api/tests/app.test.ts:76-96`) | Sin token CSRF propio; si el frontend se sirve desde otro site, SameSite no cubre GET con efectos o embeds | Parcialmente mitigada (diferido: token de doble envío — ver Prioridades) |
| XSS reflejado vía errores | Respuestas de error y validación | Baja | Medio | Todo error es `application/problem+json` sin HTML (`apps/api/src/http/errors.ts:5, 22-33`); `detail` genérico en 500; `code`/`title`/`requestId`/`instance` acotados (`packages/core/src/problem.ts:39-48`); `/docs` es estático; nombres de archivo saneados y servidos con `attachment` (`modules/files/src/domain/file.entity.ts:46-60`, `modules/files/src/http/file.routes.ts:318-324`) | Rendering inseguro del `detail` en frontends externos (responsabilidad del cliente) | Mitigada |
| IDOR | Recursos de tenant (`/api/v1/files`, organizaciones, API keys, webhooks) | Media | Alto | Repositorios tenant-scoped con `{organizationId, id}` (`modules/organizations/src/infrastructure/api-key.repository.ts:35-46`); middleware de tenant resuelve membresía antes del handler (`modules/organizations/src/http/tenant-middleware.ts:36-50`); 404 para archivos ajenos sin filtrar existencia (`apps/api/tests/files-routes-db.test.ts:239-282`); invitaciones por hash de token, nunca por id desnudo | Errores de implementación futura; mitigado por tests IDOR e invariantes | Mitigada |
| Fuga cross-tenant | Todas las tablas de tenant (shared schema) | Media | Alto | Toda búsqueda lleva `organizationId`; tokens firmados embeben la org del token (`modules/files/src/application/signed-url.ts:110-113`); descarga pública acotada por la org del token (`files-routes-db.test.ts:262-272`); API keys por organización; outbox y jobs tenant-scoped; org desconocida → 404 (no revela existencia, `tenant-middleware.ts:41-44`) | Backfill de `organization_id` en migraciones manuales (generador advierte, no automatiza) | Mitigada |
| Escalada de privilegios | Roles de organización, rutas demo `requirePermission` | Media | Alto | `requirePermission` deny-by-default sin sesión → 401, sin permiso → 403 (`apps/api/src/routes.ts:230-275`; `getRoles` default `[]`, `apps/api/src/app.ts:40`; ADR-0006); guards de rol en use cases (API keys solo owner/admin `modules/organizations/src/application/create-api-key.ts:60-62`; transferencia solo owner `transfer-ownership.ts:47-49`); último owner protegido (`remove-member.ts:54`) | Roles de org predefinidos sin tabla dinámica (diferido en catálogo) | Mitigada |
| Invitaciones robadas | `POST /accept-invitation` | Baja | Alto | Token de un solo uso con expiración (`modules/organizations/src/domain/invitation.entity.ts:25-32`); almacenado solo como hash (`accept-invitation.ts:31`); búsqueda por hash; auditoría del evento | Sin rate limiting en `accept-invitation` (ver Prioridades) | Mitigada |
| Transferencia de propiedad | `POST /:id/ownership` | Baja | Medio | Solo el owner transfiere; el target debe ser miembro activo; el anterior owner pasa a admin (`modules/organizations/src/application/transfer-ownership.ts:29-74`); evento `ownership.transferred` auditado (`organization-audit.ts:69-72`) | Confusión de usuarios entre dos owners concurrentes (UX, no autorización) | Mitigada |
| Fuga de API keys | `api_keys`, middleware bearer | Media | Alto | Secreto de un solo uso en la creación (`create-api-key.ts:66-102`); almacenamiento solo-hash sha256 (`modules/organizations/src/application/api-key-token.ts`); prefijo de 8 chars; revocación y expiración; auditoría con solo nombre+prefijo (`organization-audit.ts:86-92`); clave inválida/revocada/expirada → 401 indistinto (`api-key-middleware.ts:45-49`) | Clave presente en logs de clientes externos (fuera del control de la API) | Mitigada |
| Replay de webhooks | `POST /webhooks/incoming/:provider`, entregas salientes | Baja | Medio | Firma HMAC timing-safe sobre el cuerpo crudo (`modules/organizations/src/application/webhook-signature.ts:39-55`); ventana de frescura de 5 minutos (63-70); verificación **antes** de parsear y de almacenar (`receive-incoming-webhook.ts:100-116`); dedupe por `(provider, event_id)` con unicidad en DB (migración 0009); `idempotency-key` y `event-id` en salientes (`deliver-webhook.ts`) | Secretos de proveedor en un `Map` estático (almacén en DB documentado como mejora futura); 202 duplicado también responde | Mitigada |
| Subida de archivos | `POST /api/v1/files` | Media | Medio | Allowlist MIME (`modules/files/src/domain/file.entity.ts:22-29`); tope de 10 MiB en la ruta con 413 (`modules/files/src/http/file.routes.ts`, fix de este WU); nombres saneados (basename, sin controles, máx. 200); sha256 del contenido; clave de almacenamiento generada por el servidor; soft-delete; nunca se sirven bytes desde el proceso (descarga por token firmado) | El runtime resuelve el tipo MIME de la parte por la extensión del nombre (quirk de Bun), no por la cabecera declarada; sin validación de magic bytes | Mitigada (residual: validación de contenido diferida) |
| Abuso de endpoints públicos | `/health`, `/ready`, `/version`, `/openapi.json`, `/docs`, webhook entrante, `GET /files/download` | Alta | Medio | `bodyLimit` 1 MiB global con excepción de subida (`apps/api/src/app.ts:65`) + `timeout` 10 s (`app.ts:66`); descarga y webhook protegidos por firma/token con expiración | Sin rate limiting ni captcha; abuso/DoS de bajo costo sobre rutas públicas | Parcialmente mitigada (diferido: rate limiting — ver Prioridades) |
| Exportación masiva | Endpoints de listado | Baja | Medio | No existe endpoint de exportación; listados paginados y acotados (`file.routes.ts:244-248` limit 1-100; auditoría ≤ 1000, `packages/audit/src/audit-logger.ts:57-63`) | Futuro endpoint de exportación debe exigir permiso, rate limiting y auditoría (política en Prioridades) | No aplicable hoy (política para futuros exports) |
| Acciones de soporte | Sin superficie | Baja | Alto | No existe impersonación, soporte ni admin global en el starter (hermético por defecto: rutas de organizaciones/archivos solo se montan si se cablean, `apps/api/src/routes.ts:172-227`) | Si se añade superficie sin los controles §20.3 | No aplicable (política en §20.3) |
| Inyección de prompts en herramientas IA | Sin herramientas IA | Baja | Alto | No hay integraciones de IA en el starter (no se ejecuta código ni queries a partir de texto externo) | Futuras herramientas deben tratar el input del modelo como no confiable y ejecutar acciones solo con consentimiento explícito | No aplicable (política: ver riesgo residual) |

## Controles obligatorios (20.2)

| Control | Estado | Evidencia |
|---|---|---|
| Deny by default | Implementado | `requirePermission` 401/403 (`routes.ts:230-275`); resolvedor de roles default `[]` (`app.ts:42`); `authorize()` niega roles desconocidos (ADR-0006); API key sin sesión no autoriza (`api-key-middleware.ts:36-44`) |
| Validación de entrada | Implementado | Schemas zod + `sValidator` en query/body de rutas (`file.routes.ts:244-248, 295, 411-417`); errores mapeados a `errors[]` (`packages/core/src/problem.ts:112-117`); contrato OpenAPI verificado por test (`apps/api/tests/openapi.test.ts`) |
| Límites de payload | Implementado | `bodyLimit` 1 MiB global excepto `POST /api/v1/files` (10 MiB en la ruta, `app.ts:65` + `file.routes.ts`); `timeout` 10 s (`app.ts:66`); multipart acotado por `content-length`/streaming. Fix de este WU: el tope de 10 MiB documentado era inalcanzable (el límite global lo cortaba en ~1 MiB con 413) |
| Rate limiting | Diferido | No existe middleware de rate limiting. Recomendado para rutas públicas y `accept-invitation` (ver Prioridades). No se implementa en este WU por alcance |
| Request ID | Implementado | `requestId()` con UUID validado y eco seguro (`app.ts:61`; `hono/request-id` valida `[\w\-=]` y longitud); presente en problemas (`errors.ts:27`) y logs (`logger.ts:19`) |
| Secretos fuertes | Implementado | `BETTER_AUTH_SECRET` mín. 32 chars (`env.ts:20`); HMAC-SHA256 timing-safe (`webhook-signature.ts`, `signed-url.ts`). Nota: `signedUrlSecret`/secretos de webhook se inyectan por wiring sin validación de longitud (diferido menor, ver Prioridades) |
| Rotación | Implementado | Rotación de secretos de webhooks (`rotate-webhook-secret.ts`); API keys: crear nueva + revocar antigua con expiración; sesiones revocables (`auth.test.ts:232-239`) |
| Cookies seguras | Implementado | `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` bajo HTTPS (`auth.test.ts:74-84, 305`) |
| Allowlist CORS | Implementado | `cors({ origin: config.CORS_ORIGINS })` (`app.ts:64`); default vacío = denegar todo origen (`env.ts:10-18`); tests de preflight (`app.test.ts:76-96`) |
| CSRF | Parcialmente mitigado | `SameSite=Lax` en cookies + origin check de Better Auth en `/api/auth/*` (403 `INVALID_ORIGIN`). Diferido: token de doble envío si el frontend deja de ser same-site |
| Redacción de logs | Implementado | Logger sin bodies ni cabeceras: solo `timestamp/level/service/environment/version/requestId/route/status/duration` (`logger.ts:13-24`); payloads de webhooks redactados (`webhook.entity.ts` `redactSensitiveKeys`); correos nunca con cuerpo (solo `to/template/dedupe/subject`) |
| Queries parametrizadas | Implementado | Todo acceso vía Drizzle sobre postgres.js con columnas tipadas (`api-key.repository.ts:35-46`); sin concatenación de SQL |
| Permisos en backend | Implementado | `requirePermission` en http + guards de membresía/rol en use cases; la decisión nunca vive en repositorios |
| Scope de tenant | Implementado | Middleware de tenant antes de cada handler (`tenant-middleware.ts:36-50`); repositorios `{organizationId, id}`; tokens firmados embeben la org |
| Auditoría | Implementado | `audit_log` append-only con trigger que rechaza UPDATE/DELETE (`migrations/0003_careless_epoch.sql`); API sin borrado (`audit-logger.ts:42-55`); best-effort por tenant (`organization-audit.ts`) |
| Cabeceras seguras | Implementado | `secureHeaders()` de Hono (`app.ts:63`) |
| Dependencias pinned | Implementado | Versiones exactas en todos los `package.json`, `bun.lock` congelado, catálogo de dependencias, CI con `--frozen-lockfile` |
| Escaneo de vulnerabilidades | Diferido | CI (`ci.yml`) tiene lint/typecheck/test/openapi/docker/migraciones/integración; sin job de escaneo de dependencias ni de imagen (ver Prioridades) |
| SBOM | Diferido (opcional) | No se genera SBOM en releases (ver Prioridades) |
| Backups probados | Diferido | Sin runbook ni script de backup/restore (WU futuro, ver Prioridades) |

## Soporte administrativo (20.3)

**Estado actual:** no existe superficie de soporte — sin impersonación, sin acciones de
soporte ni admin global. Las rutas de organizaciones, archivos y webhooks entrantes solo
se montan si la aplicación las cablea explícitamente (`apps/api/src/routes.ts:172-227`),
y aun así no existe ningún rol global. Esto cumple la parte de "disabled by default" del
spec §20.3.

**Política (se aplica si se añade soporte en el futuro):** cualquier superficie de
impersonación/soporte/admin global debe cumplir, sin excepción:

1. Deshabilitada por defecto (opt-in por configuración explícita).
2. Requerir un permiso especial (nunca el rol `owner` de una organización ni un
   `requirePermission` existente).
3. Registrar cada uso en `audit_log` (actor, target, motivo, duración, outcome).
4. Mostrar un banner visible al operador mientras la acción está activa.
5. Expirar automáticamente (máximo definido por acción, nunca indefinido).
6. Bloquear acciones sensibles mientras esté activa (borrar organizaciones, transferir
   propiedad, rotar secretos, revocar API keys).

## Datos personales (20.4)

| Tema | Estado |
|---|---|
| Clasificación | Email/nombre de usuario (`user`), emails de invitación y destinatarios de correo en auditoría y ledger (`organization-audit.ts:40-50`, `sent_mails`), metadatos de archivos (nunca contenido), payloads de webhooks redactados |
| Retención | Sin política ni job de retención para `audit_log`/logs — diferido (ver Prioridades) |
| Exportación | Sin endpoint de exportación de datos personales — diferido |
| Borrado | Sin endpoint de borrado de datos (borrado de cuenta/org sí existe como acción de negocio) — export/borrado completo diferidos |
| Redacción | Logs sin cuerpos (`logger.ts:13-24`); payloads de webhooks redactados (`redactSensitiveKeys`); correos nunca loguean el cuerpo |
| Minimización | Logs solo `requestId/route/status/duration`; auditoría mínima por evento; API keys auditadas solo con nombre+prefijo |
| Consentimiento | El registro crea la cuenta (email/contraseña); el starter no incluye declaración de privacidad ni consentimiento formal — diferido a política del producto |

## Prioridades

Orden sugerido de remediación (esfuerzo aproximado):

1. **Rate limiting (S)** — `hono/rate-limiter` o equivalente por IP/API key sobre rutas
   públicas (`/api/auth/*`, webhook entrante, `GET /files/download`) y sobre
   `accept-invitation`; backoff y almacén en memoria/Redis. Cierra "abuso de endpoints
   públicos" y reduce el abuso de invitaciones.
2. **Escaneo de vulnerabilidades en CI (M)** — `bun audit` + escáner de imagen
   (grype/trivy) como job adicional de `ci.yml`; con schedule periódico fuera de PR.
3. **Runbook de backups probados (M)** — `pg_dump` + restore periódico con verificación
   (cierra el control 20.2 "tested backups").
4. **CSRF hardening (M)** — token de doble envío solo si el frontend se sirve cross-site;
   con `SameSite=Lax` + origin checks actuales, no es urgente.
5. **Validación de magic bytes en archivos (M)** — complementar la allowlist MIME con
   detección de contenido (el runtime decide el tipo por extensión del nombre; los
   archivos se sirven como `attachment`, pero el contenido real no se verifica).
6. **Retención de auditoría y logs (M)** — política + job de retención (también cierra
   §20.4 retención).
7. **SBOM (L)** — generar con syft en cada release (control 20.2 opcional).
8. **Validación de secretos de wiring (L)** — longitud mínima para `signedUrlSecret` y
   secretos de webhook en la configuración.

## Verificación de este documento

- Revisión de código de los controles §20.2 contra `apps/api/src`, `packages/*`,
  `modules/*` (verificaciones explícitas del WU1: sin `console.log` de cuerpos/cabeceras
  de autorización; sin stack traces en problemas; recursos de tenant con
  `organizationId`; la descarga pública verifica expiración del token; el webhook
  entrante verifica la firma antes de parsear; sin valores de `.env` en archivos
  commiteados; sin dependencias `"latest"`).
- Único cambio de código de este WU: alineación del tope de subida de archivos (10 MiB)
  con el límite global de payload (1 MiB) en `apps/api/src/app.ts` y
  `modules/files/src/http/file.routes.ts`, con tests en
  `modules/files/tests/file-routes.test.ts`.
