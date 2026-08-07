# CLI

**Audiencia:** usuarios y mantenedores.
**Objetivo:** referencia de todos los comandos del generador y scripts de `package.json`.

Todos los comandos del generador se ejecutan **desde el checkout del starter** (el directorio `generator/` no se copia a los proyectos generados) y aceptan `--flag=valor` o `--flag valor` salvo indicación contraria.

## Scripts de `package.json`

| Script | Qué hace |
|---|---|
| `dev` | servidor en watch (`apps/api/src/server.ts`) |
| `lint` / `format` | `biome ci .` / `biome format --write .` |
| `typecheck` | `bun x tsc --noEmit` |
| `test` / `test:coverage` | suite / con umbral 0.8 (`bunfig.toml`) |
| `load-test` | prueba de carga reproducible (ver [operations/load-testing.md](../operations/load-testing.md)) |
| `worker` | worker standalone del outbox |
| `db:generate` / `db:migrate` / `db:seed` | regenerar migraciones / aplicarlas / datos semilla |
| `db:up` / `db:down` | levantar/detener postgres 17 local (podman) |
| `db:backup` / `db:restore` | volcado/restauración pg_dump (ver [operations/backup-and-restore.md](../operations/backup-and-restore.md)) |
| `generator:sync` | sincroniza los manifests JSON del catálogo desde el código |
| `generator:validate` | valida el catálogo (perfiles/features) |
| `generator:doctor` | diagnostica un proyecto generado |
| `generator:diff` | vista previa read-only de la actualización |
| `generator:update` | aplica la actualización (`--apply`) |
| `generator:adopt` | crea manifiesto para proyectos legacy |
| `add:feature` | añade una feature a un proyecto |
| `create:project` | genera un proyecto nuevo |
| `create:module` | genera un esqueleto de módulo |
| `docs:check` | comprueba enlaces y coherencia de la documentación |

## `create:project`

```text
usage: bun run create:project -- --profile <id> --out <dir> [--force]
       bun run create:project -- --features <csv> --out <dir> [--force]
       bun run create:project -- --profile <id> --with <csv> --out <dir> [--force]
       bun run create:project -- --list-profiles [--json]
       bun run create:project -- --list-features [--json]
```

| Opción | Descripción |
|---|---|
| `--profile=<id>` | perfil del catálogo (`minimal`, `data-api`, `authenticated`, `multi-tenant-core`, `integration-platform`, `platform`; `multi-tenant` deprecated) |
| `--features=<csv>` | composición exacta de features (dependencias transitivas automáticas) |
| `--with=<csv>` | extiende un `--profile` con features adicionales |
| `--out=<dir>` | directorio de salida (obligatorio con `--profile`/`--features`); falla si no está vacío salvo `--force` |
| `--list-profiles` / `--list-features` | enumera el catálogo (`--json` para CI/agentes) |
| `--force` | permite recrear un destino no vacío |

Ejemplos:

```bash
bun run create:project -- --profile=minimal --out=../my-api
bun run create:project -- --profile=multi-tenant-core --with=files,notifications --out=../my-saas
bun run create:project -- --features=persistence,auth,authorization --out=../custom-api
bun run create:project -- --list-profiles --json
```

## `create:module`

```text
usage: bun run create:module -- --name=<kebab-name> --scope=<global|user|tenant> [--crud] [--events] [--audit] [--out=<parent>] [--force]
```

| Opción | Descripción |
|---|---|
| `--name` | nombre en kebab-case (obligatorio) |
| `--scope` | `global` \| `user` \| `tenant` (obligatorio; `tenant` añade el cableado multi-tenant) |
| `--crud` / `--events` / `--audit` | genera CRUD, eventos de dominio y auditoría best-effort |
| `--out` | directorio padre de `modules/` (para apuntar a un proyecto generado) |
| `--force` | sobrescribe el destino |

Ejemplo: `bun run create:module -- --name=customers --scope=global --crud --out=../my-api/modules`

## `add:feature`

```text
usage: bun run add:feature -- --feature=<id> --project=<dir> [--with-requires] [--force]
```

| Opción | Descripción |
|---|---|
| `--feature` | feature del catálogo (`multitenancy` es alias de `tenancy`) |
| `--project` | proyecto generado de destino |
| `--with-requires` | resuelve las dependencias transitivas faltantes |
| `--force` | permite sobrescribir archivos custom protegidos |

Escribe `FEATURE_PLAN.md` en el proyecto. Al añadir `tenancy` avisa y deja un plan de migración de datos que **nunca ejecuta**.

## `generator:validate`

```text
usage: bun run generator:validate [-- --profile=<id>] [--list-profiles] [--list-features] [--json]
```

Valida el catálogo completo (IDs únicos, features conocidas, dependencias transitivas, conflictos, ciclos, orden determinista, reemplazos deprecated, `platform` = unión completa salvo `dynamicRoles`). Exit code 0 si es válido.

## `generator:doctor`

```text
usage: bun run generator:doctor -- --project=<dir> [--json]
```

Diagnostica sin modificar: manifiesto ausente/inválido, versión desconocida, features inválidas/conflictivas, archivos gestionados faltantes/modificados, hashes desactualizados, migraciones no aplicadas, composición inconsistente, residuos de features deshabilitadas, estado git sucio (warning).

## `generator:diff`

```text
usage: bun run generator:diff -- --project=<dir> [--to=<version>] [--json]
```

Vista previa read-only contra la versión canónica del checkout. Clasifica cada archivo (`add`/`update-safe`/`remove-safe`/`unchanged`/`customized-no-upstream-change`/`conflict`/`manual-migration`), expone la ruta de actualización (`updatePath` con `breakingNotes`/`requiresManual`) y explica cada conflicto. **Exit code no cero** si hay conflictos, migraciones manuales o ruta inválida. `--to` debe coincidir con la canónica o se rechaza.

## `generator:update`

```text
usage: bun run generator:update -- --project=<dir> [--to=<version>] [--apply]
```

- Sin `--apply` es dry-run puro (igual que `diff`), sin escribir ni validar.
- Con `--apply`: aplica solo operaciones seguras, crea respaldo en `.api-starter/backups/<timestamp>/`, ejecuta validaciones posteriores (typecheck obligatoria; lint/test si el proyecto declara los scripts) con timeout de 30 s y revierte automáticamente si fallan; registra cada `Update.id` en `manifest.appliedUpdates` y es idempotente.
- No hay `--force` global; con conflictos o `manual-migration` no aplica.
- `.env` nunca se toca.

## `generator:adopt`

```text
usage: bun run generator:adopt -- --project=<dir> --baseline=<version>
```

Crea `.api-starter/manifest.json` para proyectos legacy con solo `GENERATED.md`. Exige `--baseline` materializable (hoy solo la canónica), reporta `intact`/`customized`/`missing` y solo escribe si es verificable.

## Dry-run vs `--apply` (resumen)

| Comando | Lee | Escribe en el proyecto |
|---|---|---|
| `doctor` | manifiesto + proyecto | no |
| `diff` | materializa canónica | no |
| `update` (sin `--apply`) | materializa canónica | no |
| `update --apply` | materializa canónica | sí (seguro + respaldo + validaciones) |
| `adopt` | proyecto legacy | solo el manifiesto |
| `add:feature` | proyecto | sí (plan + archivos) |

## Códigos de salida

- 0: éxito.
- Distinto de 0: error de argumentos, catálogo inválido, destino no vacío sin `--force`, conflictos o migraciones manuales en `diff`/`update`, o validaciones posteriores fallidas (con rollback).
