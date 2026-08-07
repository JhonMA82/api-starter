# Capas y dirección de dependencias

**Audiencia:** desarrolladores del starter y de proyectos generados.
**Objetivo:** reglas de capas, imports, bootstrap y portabilidad.

## Dirección de dependencias

```
domain ← application ← http
```

- `domain`: lógica pura, sin importaciones de Hono ni Bun, sin E/S (ej. `modules/example/src/domain/greeting.ts`).
- `application`: orquesta la capa `domain`; puede depender de contratos y de `packages/core`; sin Hono ni Bun.
- `http`: rutas de Hono, validación con zod y respuesta `application/problem+json`; es la única capa que conoce el framework.
- `packages/*`: plataforma compartida — `config` (entorno), `core` (errores RFC 9457, logger, métricas, tracer), `contracts` (schemas zod base), `auth`, `auth-client`, `authorization`, `audit`, `sdk`.
- `apps/api`: composición — middleware pipeline, rutas base, `openapi.json` y `/docs`, bootstrap y el entrypoint `server.ts`.

## Reglas de imports y ownership

| Regla | Detalle |
|---|---|
| Paquetes sin Hono ni Bun | Los `packages/*` no importan Hono ni Bun. Excepción explícita: `auth` (Hono solo como tipo y better-auth) y `auth-client` (solo better-auth). |
| `authorization` 100% puro | Sin dependencias de runtime. |
| `audit` acotado | Puede importar drizzle-orm y postgres; no Hono, Bun ni better-auth. |
| Módulos sin auth | Los `modules/*` no importan `@consulting/auth` ni `@consulting/auth-client`. |
| Permisos en http | Los módulos no deciden permisos con `@consulting/authorization` en repositorios: la decisión vive en http vía `requirePermission`. |
| Único archivo con Bun | Solo `apps/api/src/server.ts` toca APIs de Bun (`Bun.serve`, shutdown con drenado). Es la frontera de portabilidad del proyecto. |
| Auditoría por tenant | `modules/organizations` puede importar `@consulting/audit` (tipos y API de registro) desde la capa http/application. |

## Bootstrap y adaptadores

La aplicación se compone con un único punto de costura, `createApp(config, options)` en `apps/api/src/app.ts`:

- `config` — entorno ya validado por `packages/config` (fail-fast: si falta una variable obligatoria o un valor es inválido, el proceso falla antes de escuchar).
- `options.auth` — instancia de Better Auth opcional; cuando está presente monta `/api/auth/*` después de la cadena de middleware (requestId → jsonLogger → metrics → secureHeaders → cors → bodyLimit → timeout → compress) e inyecta el middleware de sesión.
- `options.getRoles` — resolvedor de roles para `requirePermission`, con default deny (`async () => []`).
- `options.organizations` — repositorios y servicios de tenancy; cuando están presentes se montan las rutas de organizaciones, archivos y webhooks entrantes.

Los adaptadores de infraestructura (repositorios, almacenamiento, mailer, job queue) se inyectan desde el bootstrap; el código de negocio depende de interfaces (`ports`), nunca de implementaciones concretas.

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
