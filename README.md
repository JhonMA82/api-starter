# @consulting/api-starter

Plantilla reutilizable de API HTTP en **Bun 1.3.14 + Hono**, organizada como monolito modular con workspaces. Incluye validación de configuración fail-fast, modelo de errores RFC 9457, contratos OpenAPI 3.1 generados desde schemas zod, logger estructurado JSON, imagen Docker multi-stage no-root, persistencia PostgreSQL con Drizzle (Fase 2), autenticación con Better Auth (Fase 3), autorización deny-by-default y auditoría append-only (Fase 4), multi-tenancy con organizaciones, membresías e invitaciones (Fase 5), CI de 8 jobs y tests con umbral de cobertura.

## Quickstart

### Prerequisitos

- [Bun](https://bun.sh) `1.3.14` (el archivo `.bun-version` fija la versión; `oven-sh/setup-bun` la respeta en CI).
- Docker (opcional, para el perfil `core` de Docker Compose).

### Instalación

```bash
bun install
```

### Entorno

Copia `.env.example` a `.env` y ajusta los valores si es necesario. `LOG_LEVEL`, `DATABASE_URL` y `BETTER_AUTH_SECRET` son obligatorios; el resto de variables tienen valores por defecto:

```bash
cp .env.example .env
```

Variables disponibles (`.env.example`):

| Variable | Obligatoria | Por defecto | Descripción |
|---|---|---|---|
| `APP_ENV` | no | `development` | `development` \| `test` \| `production` |
| `APP_VERSION` | no | `0.1.0` | Versión reportada en `/version` |
| `API_BASE_URL` | no | `http://localhost:3000` | URL base pública de la API |
| `LOG_LEVEL` | **sí** | — | `debug` \| `info` \| `warn` \| `error` |
| `PORT` | no | `3000` | Puerto HTTP (1–65535) |
| `HOST` | no | `0.0.0.0` | Interfaz de escucha |
| `CORS_ORIGINS` | no | `""` (denegar todo) | Lista separada por comas de orígenes permitidos |
| `DATABASE_URL` | **sí** | — | URL de conexión PostgreSQL (el servidor no conecta; los scripts y tests de DB sí) |
| `BETTER_AUTH_SECRET` | **sí** | — | Secreto de firma de Better Auth (mínimo 32 caracteres) |
| `BETTER_AUTH_URL` | no | — (usa `API_BASE_URL`) | URL base pública de autenticación |
| `TRUSTED_ORIGINS` | no | `""` (solo el origen de `API_BASE_URL`) | Lista separada por comas de orígenes adicionales de confianza |

### Persistencia (Fase 2)

PostgreSQL 17 + Drizzle ORM, con migraciones SQL commitadas. Requiere podman (o Docker, ver runbook) y el contenedor se gestiona con scripts de `package.json`:

```bash
cp .env.example .env        # asegura DATABASE_URL
bun run db:up               # levanta postgres 17 (contenedor api-pg, volumen api-pg-data)
bun run db:migrate          # aplica las migraciones pendientes (idempotente)
bun run db:seed             # datos semilla (re-ejecutar inserta 0 filas)
bun run db:down             # detiene el contenedor (el volumen se conserva)
```

Alternativa con Docker Compose: `docker compose --profile database up -d postgres`. Guía completa de migraciones en [`docs/migrations-runbook.md`](docs/migrations-runbook.md).

### Autenticación (Fase 3)

Autenticación con **Better Auth 1.6.25**, aislado en el paquete `packages/auth`
(`@consulting/auth`, servidor) y con un cliente browser-safe en `packages/auth-client`
(`@consulting/auth-client`). Al inyectar una instancia en `createApp(config, { auth })`,
el servidor monta las rutas de sesión bajo `/api/auth/*`:

- `sign-up/email` y `sign-in/email` — registro e inicio de sesión con email y contraseña.
- `sign-out` y `revoke-session` — cierre de sesión y revocación de sesión.
- `get-session` — sesión actual (`user`/`session` disponibles en las rutas protegidas).
- `open-api/generate-schema` — esquema OpenAPI 3.1.1 del subsistema, expuesto como fuente "Auth" en `/docs` (Scalar).

Las sesiones viajan en cookies `HttpOnly` con `SameSite=Lax` y `Secure` bajo HTTPS;
también se soportan tokens bearer (plugin `bearer()`). Better Auth valida el origen
de cada petición contra el origen de `API_BASE_URL` y la lista `TRUSTED_ORIGINS`;
los orígenes ajenos se rechazan (`403 INVALID_ORIGIN`).

Los tests de autenticación contra base de datos real viven en
`apps/api/tests/auth.test.ts` y `packages/auth/tests/auth-migrations.test.ts`; se
saltan si `DATABASE_URL` no está definido (ver [Tests](#tests)).

### Autorización (Fase 4)

Autorización **deny-by-default** en el núcleo puro `packages/authorization`
(`@consulting/authorization`, sin dependencias de runtime): catálogo explícito de
permisos `request.*` (create/read/update/assign/review/approve/reject/export/
delete, sin wildcards), roles `admin`/`reviewer`/`member` y funciones de política
ABAC (`canUpdateRequest`, `canApproveRequest`, `canDeleteRequest`).

- **Enforcement:** middleware `requirePermission(permission, resolveRoles)` — sin
  sesión → `401 UNAUTHORIZED`, permiso denegado → `403 FORBIDDEN` (códigos
  problem+json nuevos); la costura `createApp(config, { auth, getRoles })` recibe
  el resolvedor de roles con default `async () => []`.
- **Rutas demo:** `GET /api/v1/authorization/protected` (permiso `request.read`) y
  `GET /api/v1/authorization/admin` (permiso `request.delete`, solo admin).
- **Auditoría:** `packages/audit` (`@consulting/audit`) con tabla `audit_log`
  append-only (migración 0003) protegida por trigger a nivel de base de datos;
  API `record(input)` / `list({ limit? })` sin borrado.

### Multi-tenancy (Fase 5)

Perfil multi-tenant con **shared schema** (una base de datos, filas por tenant)
en el módulo `modules/organizations`: organizaciones, membresías e
invitaciones con roles predefinidos (`owner`/`admin`/`auditor`/`member`).

- **Contexto de tenant:** cada petición tenant-scoped viaja con la cabecera
  `x-organization-id`; el middleware resuelve `TenantContext` (organización +
  membresía + rol) antes del handler. Organización desconocida → `404`, sin
  membresía activa u organización suspendida → `403`.
- **Repositorios tenant-scoped:** toda búsqueda lleva `{ organizationId, id }`
  (las invitaciones se resuelven por hash del token); tests IDOR prueban el
  aislamiento cross-tenant.
- **Ciclo de vida:** crear organización, invitar por email (token de un solo
  uso), aceptar invitación, transferir propiedad, suspender, eliminar miembro y
  borrar con confirmación fuerte (`confirm=true`). Invariantes: guard del
  último owner, expiración/no-reutilización de invitaciones.
- **Auditoría por tenant:** cada éxito del ciclo de vida registra una fila en
  `audit_log` (`resourceType: "organization"`, `resourceId`, actor y outcome)
  vía `createOrganizationAudit` sobre `@consulting/audit`; es best-effort y
  nunca rompe la operación.

### Desarrollo

```bash
bun run dev
```

Arranca `apps/api/src/server.ts` en modo watch. El servidor responde en `http://localhost:3000` y termina limpiamente con SIGTERM/SIGINT (drena las peticiones en vuelo).

### Endpoints

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/health` | Sonda de vida (liveness) |
| GET | `/ready` | Sonda de disponibilidad (readiness) |
| GET | `/version` | Nombre, versión y entorno del servicio |
| GET | `/openapi.json` | Documento OpenAPI 3.1.0 generado desde los contratos |
| GET | `/docs` | Interfaz de documentación interactiva (Scalar) |
| GET/POST | `/api/auth/*` | Autenticación Better Auth: registro, sesión, sign-out, revocación, bearer |
| GET | `/api/v1/authorization/protected` | Ruta demo protegida por permiso `request.read` (requiere sesión) |
| GET | `/api/v1/authorization/admin` | Ruta demo protegida por permiso `request.delete` (solo rol admin) |
| POST | `/api/v1/organizations` | Crea una organización propiedad del usuario autenticado |
| GET | `/api/v1/organizations/:id` | Contexto de tenant del llamante (requiere `x-organization-id`) |
| POST | `/api/v1/organizations/:id/invitations` | Invita por email; devuelve el token de un solo uso |
| POST | `/api/v1/organizations/accept-invitation` | Acepta una invitación con su token y entra a la organización |
| POST | `/api/v1/organizations/:id/ownership` | Transfiere la propiedad a otro miembro |
| POST | `/api/v1/organizations/:id/suspend` | Suspende la organización (los miembros pierden acceso) |
| DELETE | `/api/v1/organizations/:id/members/:userId` | Elimina un miembro (el último owner no puede eliminarse) |
| DELETE | `/api/v1/organizations/:id?confirm=true` | Borra la organización tras confirmación fuerte (cascada) |
| GET | `/api/v1/example/hello?name=...` | Módulo de ejemplo (demuestra la estructura por capas) |

Los errores se devuelven como `application/problem+json` (RFC 9457) con `code`, `requestId` e `instance`.

### Tests

```bash
bun test              # suite completa
bun test --coverage   # con umbral global 0.8 (bunfig.toml)
bun run lint          # biome ci .
bun run typecheck     # bun x tsc --noEmit
```

Los tests de base de datos reales (`modules/notes/tests`,
`apps/api/tests/auth.test.ts`, `packages/auth/tests/auth-migrations.test.ts` y
`packages/audit/tests`) **se saltan** si `DATABASE_URL` no está definido. Para
ejecutarlos contra el postgres local (con `db:up` levantado), usa
`--parallel=1` — los archivos de tests de DB resetean esquemas y deben correr
serializados:

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5432/api bun test --parallel=1
```

### Docker

```bash
docker build -t consulting-api:0.1.0 .
docker run --rm -e LOG_LEVEL=info -p 3000:3000 consulting-api:0.1.0
```

La imagen es multi-stage sobre `oven/bun:1.3.14-slim`, ejecuta como usuario no-root `bun` y expone un healthcheck contra `/health`.

Docker Compose (perfil `core`, solo la API; sin base de datos ni redis):

```bash
docker compose --profile core up
```

### CI

Cada pull request pasa por `.github/workflows/ci.yml`: 8 jobs (`lint`, `typecheck`, `test`, `openapi-validation`, `docker-build`, `migrations-check`, `integration-test`, `migration-test`) con acciones fijadas por tag completo y `bun install --frozen-lockfile`. `integration-test` y `migration-test` corren con un servicio `postgres:17-alpine` y health check `pg_isready`; `migrations-check` detecta drift entre schema y migraciones commitadas.

### Estructura del repositorio

```
api/
├─ .bun-version            versión de Bun fijada (1.3.14)
├─ .env.example            plantilla de entorno (sin secretos)
├─ Dockerfile              imagen multi-stage no-root
├─ docker-compose.yml      perfiles "core" (api) y "database" (postgres)
├─ bunfig.toml             umbral de cobertura 0.8
├─ catalog/dependencies.json   registro de dependencias (versión, licencia, propósito)
├─ docs/architecture.md    visión, capas, matriz de portabilidad (español)
├─ docs/decisions/         ADR 0001–0007 (inglés)
├─ docs/migrations-runbook.md   runbook de migraciones (español)
├─ migrations/             migraciones SQL commitadas + snapshots (drizzle-kit)
├─ scripts/db/             runners de migración y seeds (db:migrate, db:seed)
├─ apps/api/               aplicación HTTP (middleware, rutas base, bootstrap, server)
├─ packages/config/        validación fail-fast de entorno (zod)
├─ packages/core/          modelo de errores RFC 9457 + contrato de logger
├─ packages/contracts/     schemas zod base (triple fuente: tipos, OpenAPI, tests)
├─ packages/auth/          servidor de autenticación Better Auth (identidad y sesiones)
├─ packages/auth-client/   cliente browser-safe de Better Auth (sin Hono ni Bun)
├─ packages/authorization/ catálogo de permisos, roles y políticas ABAC (deny by default)
├─ packages/audit/         log de auditoría append-only (tabla + trigger + API record/list)
└─ modules/
   ├─ example/             módulo de ejemplo por capas (domain/application/http)
   ├─ notes/               módulo de referencia con persistencia (Fase 2)
   └─ organizations/       cluster multi-tenant: organizaciones/membresías/invitaciones (Fase 5)
```

## Convenciones

- Versiones exactas en todos los manifests (sin `^`/`~`/`latest`); `bun.lock` se commitea y no se edita a mano.
- Prosa de la documentación en español; código, comandos e identificadores en inglés. Los ADR quedan en inglés.
- Dirección de dependencias: `domain ← application ← http`; solo `apps/api/src/server.ts` toca APIs de Bun.
