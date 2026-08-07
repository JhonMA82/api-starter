# Desarrollo del starter

**Audiencia:** mantenedores de `api-starter`.
**Objetivo:** cómo trabajar en el repositorio base, el generador y el catálogo sin romper la fábrica.

## Instalación

```bash
bun install           # workspaces + bun.lock fijado (no editar a mano)
cp .env.example .env  # variables obligatorias: LOG_LEVEL, DATABASE_URL, BETTER_AUTH_SECRET
bun run dev           # apps/api/src/server.ts en watch
```

Base de datos local: `bun run db:up && bun run db:migrate` (ver [operations/migrations.md](../operations/migrations.md)).

## Estructura interna

- `apps/api` — composición de la aplicación (middleware, rutas, bootstrap, `server.ts`).
- `packages/*` — plataforma compartida (config, core, contracts, auth, authorization, audit, sdk).
- `modules/*` — clusters de dominio con la tríada `domain ← application ← http` + infraestructura y tests.
- `generator/` — tooling fuera de los workspaces: `src/` (CLI), `templates/` (plantillas), `updates/` (migraciones versionadas), `tests/`.
- `docs/` — documentación (índice en [docs/README.md](../README.md)); históricos en `docs/archive/`.

## Reglas de imports y ownership

Resumen operativo (completo en [architecture/layers-and-boundaries.md](../architecture/layers-and-boundaries.md) y `AGENTS.md`):

- `domain ← application ← http`; sin Hono ni Bun fuera de la capa http y de `server.ts`.
- `packages/*` sin Hono ni Bun (excepciones: `auth` solo tipos + better-auth; `auth-client` solo better-auth).
- `authorization` 100% puro; `audit` puede importar drizzle-orm y postgres.
- `modules/*` no importan `@consulting/auth` ni `@consulting/auth-client`; los permisos se deciden en http vía `requirePermission`.
- Único archivo que toca APIs de Bun: `apps/api/src/server.ts`.
- Versiones exactas (sin `^`/`~`/`latest`); toda dependencia nueva se registra en `catalog/dependencies.json` con versión, licencia, propósito y fuente.

## Sincronización de manifests del catálogo

El catálogo vive en el código (`generator/src/profiles.ts`, `generator/src/features.ts`) y se refleja en `generator/profiles.json` / `generator/features.json`:

```bash
bun run generator:sync      # regenera los JSON
bun run generator:validate  # valida el catálogo completo
```

`generator:validate` verifica IDs únicos, features conocidas, dependencias transitivas, conflictos, ciclos, orden determinista, reemplazos deprecated y que `platform` sea la unión completa salvo `dynamicRoles`. El test `generator/tests/version-sync.test.ts` comprueba que `STARTER_VERSION` derive de `package.json`.

## Cómo añadir o cambiar una feature

1. Pasa la puerta de admisión: [feature-proposal-template.md](feature-proposal-template.md) y [evolution-policy.md](evolution-policy.md).
2. Crea el módulo/paquete con la tríada por capas y sus tests (patrón: `modules/notes`, `modules/files`).
3. Declara la feature en `generator/src/features.ts` (`requires`, `excludedBy`, `modules`, `packages`, `migrations`, `envVars`).
4. Añade las migraciones de la feature a `migrations/` (append-only) y regístralas en la feature.
5. Actualiza la plantilla de `env.ts`/`.env.example` si la feature introduce variables.
6. Añade el flujo de actualización en `generator/updates/registry.ts` si cambia la versión canónica.
7. `bun run generator:sync && bun run generator:validate`; ejecuta los tests del generador.
8. Actualiza la documentación: [reference/profiles-and-features.md](../reference/profiles-and-features.md) se verifica con `bun run docs:check`.

## AGENTS.md

`AGENTS.md` es la fuente de convenciones del repositorio para agentes y humanos: idiomas (prosa en español, código en inglés), capas, comandos, qué no editar y convención de commits (un work unit = un commit Conventional Commit; tests junto al comportamiento; docs junto al cambio). Manténlo sincronizado al mover rutas de documentación.
