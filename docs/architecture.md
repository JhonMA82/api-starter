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
- `packages/*`: plataforma compartida — `config` (entorno), `core` (modelo de errores RFC 9457 + contrato de logger), `contracts` (schemas zod base), `auth` (identidad y sesiones con Better Auth), `auth-client` (cliente browser-safe). Regla de límites: los paquetes no importan Hono ni Bun, con la excepción explícita de `auth` (Hono solo como tipo y better-auth) y `auth-client` (solo better-auth); `modules/*` no importan `@consulting/auth` ni `@consulting/auth-client`.
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
  (roles, catálogo de permisos y funciones de política) queda como trabajo futuro
  (Fase 4).

## Perfiles y fases futuras (resumen)

- **Fase 0+1 (completada):** fundación — registros, ADRs, núcleo HTTP con rutas base, OpenAPI 3.1 + Scalar, módulo de ejemplo, Docker y CI de 5 jobs.
- **Fase 2 (completada, persistencia):** PostgreSQL 17 + Drizzle ORM sobre postgres.js, migraciones SQL commitadas bajo `migrations/`, módulo `notes` de referencia con tests de DB reales, scripts `db:*` con podman, perfil `database` en Docker Compose y CI de 8 jobs. Ver ADR-0005 y `docs/migrations-runbook.md`.
- **Fase 3 (completada, autenticación):** Better Auth 1.6.25 aislado en `packages/auth` (`@consulting/auth`) con adaptador drizzle (migración 0002: `user`/`session`/`account`/`verification`), email/contraseña y plugins `bearer()`/openAPI; cliente browser-safe `packages/auth-client`; montaje de `/api/auth/*` y middleware de sesión vía la costura `createApp(config, { auth })`; tests de DB reales y extensión de CI. Ver [Autenticación (Fase 3)](#autenticación-fase-3).
- **Fases posteriores:** sin comprometer detalles concretos — la autorización (roles, catálogo de permisos y funciones de política) queda como Fase 4; además se prevé crecimiento hacia rutas HTTP del módulo `notes` y más módulos de negocio bajo `/api/v1`, junto con la revisión de decisiones que lo requieran (p.ej. manejo de secretos, gate de capas automatizado).
- **Perfil Docker `core`:** solo el servicio `api`. La base de datos vive en el perfil `database` (postgres) y no es un requisito del servidor HTTP.

## Modelo de datos y errores

- Errores: RFC 9457 (`application/problem+json`) con `code` estable, `requestId` e `instance`; un único normalizador (`onError`/`notFound`) mapea status → código. Ver ADR-0003.
- Contratos: schemas zod en `packages/contracts` (base) y co-localizados en cada módulo; alimentan tipos, documento OpenAPI 3.1 y tests (triple fuente). Ver ADR-0002.
