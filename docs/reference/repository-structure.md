# Estructura del repositorio

**Audiencia:** usuarios y mantenedores.
**Objetivo:** distinguir la estructura del starter, la de un proyecto generado y los directorios internos que nunca se copian.

## El starter

```
api/
├─ .bun-version            versión de Bun fijada (1.3.14)
├─ .env.example            plantilla de entorno (sin secretos)
├─ Dockerfile              imagen multi-stage no-root
├─ docker-compose.yml      perfiles core (api), database (postgres) y worker (outbox)
├─ bunfig.toml             umbral de cobertura 0.8
├─ catalog/dependencies.json   registro de dependencias (versión, licencia, propósito)
├─ generator/              CLI de generación de proyectos (perfiles, features, plantillas, updates)
├─ integrations/           ejemplos de integración frontend (TanStack Query, Next, móvil, Tauri)
├─ scripts/                scripts operativos (load test, worker, db)
├─ docs/                   documentación (índice en docs/README.md)
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

## Un proyecto generado

Misma estructura base, pero **podada físicamente** según las features seleccionadas:

- Solo existen `modules/*` y `packages/*` de las features elegidas (p. ej. `minimal` conserva `config`, `contracts`, `core`).
- `migrations/` solo conserva las migraciones de las features; el journal se renumera.
- `env.ts` y `.env.example` se adaptan a las features (ver [reference/environment.md](environment.md)).
- `GENERATED.md` (resumen) y `.api-starter/manifest.json` (registro de archivos administrados) se añaden.
- `docs/` se copia completa: la documentación de este repositorio sirve también al proyecto generado.

## Directorios de herramientas internas (no copiados al proyecto)

| Directorio | Qué es |
|---|---|
| `generator/` | CLI de generación (los scripts de `package.json` que apuntan a él quedan en el proyecto pero sin el directorio: son comandos del starter, no del proyecto) |
| `.github/` | workflows de CI del starter |
| `.comet/`, `.superpowers/`, `.opencode/`, `.agents/`, `.codegraph/`, `.atl/` | tooling local de desarrollo; excluidos de la copia |
| `coverage/`, `backups/`, `node_modules/` | artefactos locales; excluidos de la copia |
| `docs/openspec/`, `docs/superpowers/` | carpetas internas de herramientas de desarrollo; se copian por no ser dot-dirs, pero no forman parte del onboarding |

## Fuente de verdad de la poda

- `generator/src/create-project.ts` (`excludePath`) define qué segmentos y basenames se excluyen de la copia.
- El catálogo (`generator/profiles.json`, `generator/features.json`) define qué se mantiene.
