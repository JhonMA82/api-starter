# API Starter

Plantilla reutilizable de API HTTP en **Bun + Hono**, organizada como monolito modular con workspaces. Está pensada para servir de base a proyectos de la consultoría: API pequeña y pública, aplicación single-tenant, plataforma multi-tenant, backend de integraciones, etc.

## Qué incluye

| Capacidad | Resumen | Detalles |
|---|---|---|
| Configuración | Validación fail-fast del entorno (zod), sin arrancar con variables inválidas | [docs/architecture.md](docs/architecture.md#configuración) |
| Errores | Formato estándar RFC 9457 (`application/problem+json`) con `code`, `requestId` e `instance` | [docs/architecture.md](docs/architecture.md#modelo-de-errores-y-contratos) |
| OpenAPI | Documento OpenAPI 3.1 generado desde los schemas zod + docs interactivos (Scalar) en `/docs` | [docs/architecture.md](docs/architecture.md#modelo-de-errores-y-contratos) |
| Logs | Logger estructurado JSON (nunca cuerpos, correos ni secretos) | [docs/architecture.md](docs/architecture.md#operación) |
| Autenticación | Registro y sesión por email/contraseña (Better Auth), cookies y tokens bearer | [docs/architecture.md](docs/architecture.md#autenticación) |
| Autorización | Permisos deny-by-default, roles y políticas ABAC, con auditoría append-only | [docs/architecture.md](docs/architecture.md#autorización-y-auditoría) |
| Multi-tenancy | Organizaciones, membresías e invitaciones (una base, filas por tenant) | [docs/architecture.md](docs/architecture.md#multi-tenancy) |
| Integraciones | Cola de jobs, API keys por organización y webhooks firmados (salientes y entrantes) | [docs/architecture.md](docs/architecture.md#integraciones) |
| Archivos | Referencias con URLs de descarga firmadas (sin blobs en PostgreSQL) | [docs/architecture.md](docs/architecture.md#archivos) |
| Notificaciones | Correos con plantillas versionadas y dedupe (sin acoplarse a un proveedor) | [docs/architecture.md](docs/architecture.md#notificaciones) |
| Generador | CLI para crear proyectos, módulos y añadir features con poda física | [docs/architecture.md](docs/architecture.md#generador) |
| SDK | SDK TypeScript agnóstico + kits para TanStack Query, Next.js, móvil y Tauri | [docs/architecture.md](docs/architecture.md#sdk-y-kits-frontend) |
| Operación | Métricas Prometheus, Docker no-root, backup/restore probados, load test reproducible | [docs/architecture.md](docs/architecture.md#operación) |

## Requisitos

- [Bun](https://bun.sh) `1.3.14` (el archivo `.bun-version` fija la versión; CI la respeta vía `setup-bun`).
- Podman o Docker (solo para la base de datos local).

## Puesta en marcha

```bash
bun install           # instala los workspaces (bun.lock fijado)
cp .env.example .env  # plantilla de entorno; ajusta si hace falta
bun run dev           # servidor en watch en http://localhost:3000
```

Comprueba que responde: `curl http://localhost:3000/health` → `{"status":"ok"}`.

### Variables de entorno

Solo tres son obligatorias: `LOG_LEVEL`, `DATABASE_URL` y `BETTER_AUTH_SECRET`. El resto tienen valores por defecto.

| Variable | Obligatoria | Por defecto | Qué hace |
|---|---|---|---|
| `APP_ENV` | no | `development` | `development` \| `test` \| `production` |
| `APP_VERSION` | no | `0.1.0` | Versión reportada en `/version` |
| `API_BASE_URL` | no | `http://localhost:3000` | URL base pública de la API |
| `LOG_LEVEL` | **sí** | — | `debug` \| `info` \| `warn` \| `error` |
| `PORT` | no | `3000` | Puerto HTTP (1–65535) |
| `HOST` | no | `0.0.0.0` | Interfaz de escucha |
| `CORS_ORIGINS` | no | vacío (denegar todo) | Orígenes permitidos, separados por comas |
| `DATABASE_URL` | **sí** | — | URL de conexión PostgreSQL. El servidor arranca sin base, pero las rutas de autenticación, los módulos con persistencia y los tests de DB la necesitan |
| `BETTER_AUTH_SECRET` | **sí** | — | Secreto de firma de sesiones (mínimo 32 caracteres) |
| `BETTER_AUTH_URL` | no | `API_BASE_URL` | URL base pública de autenticación |
| `TRUSTED_ORIGINS` | no | solo el origen de `API_BASE_URL` | Orígenes adicionales de confianza, separados por comas |

### Base de datos local

PostgreSQL 17 + Drizzle ORM, con migraciones SQL commitadas. La base se gestiona con podman (o Docker):

```bash
bun run db:up        # levanta postgres 17 (contenedor api-pg)
bun run db:migrate   # aplica las migraciones pendientes (idempotente)
bun run db:seed      # datos semilla (idempotente: re-ejecutar inserta 0 filas)
bun run db:down      # detiene el contenedor (el volumen se conserva)
```

Alternativa con Docker Compose: `docker compose --profile database up -d postgres`. Guía completa en [`docs/migrations-runbook.md`](docs/migrations-runbook.md).

## Comandos principales

| Comando | Qué hace |
|---|---|
| `bun run dev` | servidor en watch (`apps/api/src/server.ts`) |
| `bun test` | suite completa de tests |
| `bun test --coverage` | suite con umbral de cobertura 0.8 (`bunfig.toml`) |
| `bun run lint` | `biome ci .` |
| `bun run typecheck` | `bun x tsc --noEmit` |
| `bun run load-test` | load test reproducible (ver [`docs/load-test.md`](docs/load-test.md)) |
| `bun run worker` | worker del outbox (envío de eventos y webhooks en segundo plano) |
| `bun run db:generate` | regenerar migraciones desde los schemas (gate de drift en CI) |
| `bun run db:backup` / `db:restore` | volcado/restauración pg_dump (ver [`docs/backup-restore.md`](docs/backup-restore.md)) |
| `bun run generator:validate` | valida el catálogo del generador |
| `bun run create:project` | genera un proyecto nuevo (ver [generador](docs/architecture.md#generador)) |
| `bun run add:feature` / `create:module` | añade features o módulos a un proyecto generado |

## Endpoints

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/health` | Sonda de vida (liveness) |
| GET | `/ready` | Sonda de disponibilidad (readiness) |
| GET | `/version` | Nombre, versión y entorno del servicio |
| GET | `/metrics` | Métricas en formato texto Prometheus |
| GET | `/openapi.json` | Documento OpenAPI 3.1 generado desde los contratos |
| GET | `/docs` | Documentación interactiva (Scalar) |
| GET/POST | `/api/auth/*` | Autenticación: registro, sesión, cierre, revocación, bearer |
| GET | `/api/v1/authorization/protected` | Ruta demo protegida por permiso `request.read` (requiere sesión) |
| GET | `/api/v1/authorization/admin` | Ruta demo protegida por permiso `request.delete` (solo rol admin) |
| POST | `/api/v1/organizations` | Crea una organización propiedad del usuario autenticado |
| GET | `/api/v1/organizations/:id` | Contexto de tenant del llamante (requiere `x-organization-id`) |
| POST | `/api/v1/organizations/:id/invitations` | Invita por email; devuelve el token de un solo uso |
| POST | `/api/v1/organizations/accept-invitation` | Acepta una invitación con su token |
| POST | `/api/v1/organizations/:id/ownership` | Transfiere la propiedad a otro miembro |
| POST | `/api/v1/organizations/:id/suspend` | Suspende la organización |
| DELETE | `/api/v1/organizations/:id/members/:userId` | Elimina un miembro (el último owner no puede eliminarse) |
| DELETE | `/api/v1/organizations/:id?confirm=true` | Borra la organización tras confirmación fuerte (cascada) |
| POST | `/api/v1/organizations/:id/api-keys` | Crea una API key; devuelve el secreto una sola vez |
| DELETE | `/api/v1/organizations/:id/api-keys/:keyId` | Revoca una API key |
| POST | `/api/v1/organizations/:id/webhooks` | Registra un webhook saliente; secreto de firma mostrado una sola vez |
| GET | `/api/v1/organizations/:id/webhooks` | Lista los webhooks salientes del tenant |
| POST | `/api/v1/organizations/:id/webhooks/:webhookId/rotate` | Rota el secreto de firma de un webhook |
| POST | `/api/v1/organizations/:id/webhooks/:webhookId/toggle` | Activa/desactiva un webhook saliente |
| GET | `/api/v1/organizations/:id/webhooks/:webhookId/deliveries` | Historial de entregas de un webhook |
| POST | `/api/v1/webhooks/incoming/:provider` | Webhook entrante público firmado con HMAC (202 aceptado/duplicado, 401 firma inválida, 404 proveedor desconocido) |
| POST | `/api/v1/files` | Sube un archivo multipart; devuelve 201 + `downloadUrl` de un solo uso |
| GET | `/api/v1/files?limit` | Lista los archivos del tenant |
| GET | `/api/v1/files/:id` | Metadatos de un archivo del tenant |
| DELETE | `/api/v1/files/:id` | Soft-delete de un archivo (204) |
| GET | `/api/v1/files/download?token` | Descarga pública firmada con HMAC (el token ES la autorización; 401 expirado/malformado, 404 borrado) |
| POST | `/api/v1/files/:id/url` | URL firmada nueva (1 h por defecto, tope 24 h) |
| GET | `/api/v1/example/hello?name=...` | Módulo de ejemplo (demuestra la estructura por capas) |

Los errores se devuelven como `application/problem+json` (RFC 9457) con `code`, `requestId` e `instance`.

## Tests

```bash
bun test              # suite completa
bun test --coverage   # con umbral global 0.8 (bunfig.toml)
bun run lint          # biome ci .
bun run typecheck     # bun x tsc --noEmit
```

Los tests que necesitan base de datos real (auth, auditoría, tenancy, integraciones, archivos, notificaciones, migraciones) **se saltan** si `DATABASE_URL` no está definido. Para ejecutarlos contra el postgres local (`bun run db:up` primero), usa `--parallel=1` — estos tests resetean esquemas y deben correr serializados:

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5432/api bun test --parallel=1
```

## Docker

```bash
docker build -t consulting-api:0.10.1 .
docker run --rm -e LOG_LEVEL=info -p 3000:3000 consulting-api:0.10.1
```

Imagen multi-stage sobre `oven/bun:1.3.14-slim`, ejecuta como usuario no-root y expone healthcheck contra `/health`. Perfiles de Docker Compose:

- `core` — solo la API (sin base de datos): `docker compose --profile core up`
- `database` — postgres 17
- `worker` — worker del outbox

## CI

Cada pull request pasa por `.github/workflows/ci.yml`: 8 jobs (`lint`, `typecheck`, `test`, `openapi-validation`, `docker-build`, `migrations-check`, `integration-test`, `migration-test`) con acciones fijadas por tag completo y `bun install --frozen-lockfile`. Los jobs de integración y migraciones corren con un servicio `postgres:17-alpine`; `migrations-check` detecta drift entre los schemas y las migraciones commitadas.

## Estructura del repositorio

```
api/
├─ .bun-version            versión de Bun fijada (1.3.14)
├─ .env.example            plantilla de entorno (sin secretos)
├─ Dockerfile              imagen multi-stage no-root
├─ docker-compose.yml      perfiles core (api), database (postgres) y worker (outbox)
├─ bunfig.toml             umbral de cobertura 0.8
├─ catalog/dependencies.json   registro de dependencias (versión, licencia, propósito)
├─ generator/              CLI de generación de proyectos (ver docs/architecture.md)
├─ integrations/           ejemplos de integración frontend (TanStack Query, Next, móvil, Tauri)
├─ scripts/                scripts operativos (load test, worker, db)
├─ docs/                   arquitectura, runbooks y decisiones (ver más abajo)
├─ migrations/             migraciones SQL commitadas + snapshots
├─ apps/api/               aplicación HTTP (middleware, rutas base, bootstrap, server)
├─ packages/
│  ├─ config/              validación fail-fast del entorno (zod)
│  ├─ core/                errores RFC 9457, logger, métricas, tracer
│  ├─ contracts/           schemas zod base (tipos + OpenAPI + tests)
│  ├─ auth/                autenticación Better Auth (servidor)
│  ├─ auth-client/         cliente browser-safe de Better Auth
│  ├─ authorization/       permisos, roles y políticas ABAC (deny by default)
│  ├─ audit/               log de auditoría append-only
│  └─ sdk/                 SDK TypeScript + kits frontend
└─ modules/
   ├─ example/             módulo de ejemplo por capas (domain/application/http)
   ├─ files/               archivos como referencias + URLs firmadas
   ├─ jobs/                cola de jobs y worker del outbox
   ├─ notes/               módulo de referencia con persistencia
   ├─ notifications/       correos con plantillas y dedupe
   └─ organizations/       multi-tenancy + API keys + webhooks
```

## Documentación

- [`docs/architecture.md`](docs/architecture.md) — visión, capas, y catálogo de funcionalidades
- [`docs/decisions/`](docs/decisions/) — ADR (decisiones de arquitectura, en inglés)
- [`docs/migrations-runbook.md`](docs/migrations-runbook.md) — guía de migraciones
- [`docs/backup-restore.md`](docs/backup-restore.md) — runbook de backup/restore
- [`docs/load-test.md`](docs/load-test.md) y [`docs/load-test-results.md`](docs/load-test-results.md) — load test reproducible y resultados
- [`docs/threat-model.md`](docs/threat-model.md) — modelo de amenazas
- [`docs/OPENCODE_HONO_BACKEND_REUTILIZABLE.md`](docs/OPENCODE_HONO_BACKEND_REUTILIZABLE.md) — especificación original del starter (contexto histórico)
- [`VALIDATION_REPORT.md`](VALIDATION_REPORT.md) — reporte final de validación (mantenimiento)

## Convenciones

- Versiones exactas en todos los manifests (sin `^`/`~`/`latest`); `bun.lock` se commitea y no se edita a mano.
- Prosa de la documentación en español; código, comandos e identificadores en inglés. Los ADR quedan en inglés.
- Dirección de dependencias: `domain ← application ← http`; solo `apps/api/src/server.ts` toca APIs de Bun.
