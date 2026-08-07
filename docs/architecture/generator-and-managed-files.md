# Generador y archivos administrados

**Audiencia:** mantenedores del starter y desarrolladores de proyectos generados.
**Objetivo:** cómo funciona la generación con poda física y qué archivos administra el starter en un proyecto generado.

`generator/` es tooling fuera de los workspaces de runtime. Ver ADR-0010 (generación) y ADR-0013 (política de evolución). Los comandos completos están en [reference/cli.md](../reference/cli.md).

## Generación con poda física

El catálogo tiene 12 features y 6 perfiles vigentes (`minimal`, `data-api`, `authenticated`, `multi-tenant-core`, `integration-platform`, `platform`) más `multi-tenant` preservado como alias deprecated. Los proyectos generados **excluyen físicamente** las features no seleccionadas: no son feature flags en runtime, son módulos, paquetes, migraciones y tests que no existen en el proyecto.

- `create:project` elimina físicamente módulos, paquetes, migraciones, snapshots y tests de aplicación no seleccionados, reescribe el journal de migraciones y deja `GENERATED.md` + `.api-starter/manifest.json`. Soporta `--features=<csv>` (composición exacta) y `--profile <id> --with=<csv>` (perfil curado extendido); ambas resuelven dependencias transitivas, rechazan conflictos vía `excludedBy`, muestran el plan final y validan orden determinista. `--list-profiles`/`--list-features` (con `--json`) hacen el catálogo descubrible en CI. Al seleccionar `multi-tenant` (deprecated) emite advertencia recomendando los perfiles de reemplazo pero sigue generando correctamente.
- `add:feature` calcula requisitos transitivos, acepta `multitenancy` como alias de `tenancy`, protege archivos custom mediante marcadores y escribe `FEATURE_PLAN.md`. Al añadir tenancy muestra una advertencia y un plan de migración para revisión; nunca cambia datos ni ejecuta ese plan. Los destinos no vacíos y los archivos protegidos fallan de forma segura; `--force` hace explícita la recreación o sobrescritura.
- `create:module` genera un esqueleto de módulo por capas (`domain`/`application`/`http`/`infrastructure`) con scopes `global`/`user`/`tenant` y flags `--crud`/`--events`/`--audit`.

## Validación del catálogo

`generator:validate` verifica IDs únicos, features conocidas, dependencias transitivas, conflictos, ciclos, orden determinista, reemplazos de perfiles deprecated, y que `platform` coincida con la unión completa de features salvo las diferidas (`dynamicRoles`).

## Instalación de proyectos generados

Los proyectos generados requieren `bun install`; el generador no edita `bun.lock`. El wiring de proveedores (S3/R2/MinIO, SMTP) queda a cargo de cada proyecto generado.

## Archivos administrados y actualización

Un proyecto generado lleva `.api-starter/manifest.json` (schema 1): versión del starter, features y, por archivo, hash SHA-256 y estrategia (`managed` / `structured` / `scaffold` / `ignored`). `GENERATED.md` es la vista humana.

- La versión canónica proviene **únicamente** del `package.json` del checkout del starter (`generator/src/starter-version.ts`); `--to` debe coincidir exactamente o se rechaza antes de materializar. No hay descarga remota de tags.
- `generator:doctor` diagnostica sin modificar (manifiesto ausente/inválido, versión desconocida, features conflictivas, archivos gestionados faltantes/modificados, hashes desactualizados, migraciones no aplicadas, residuos).
- `generator:diff` materializa la versión canónica con las mismas features y clasifica cada operación (`add`/`update-safe`/`remove-safe`/`unchanged`/`customized-no-upstream-change`/`conflict`/`manual-migration`), valida la ruta de actualización (`resolveUpdatePath`) y explica cada conflicto. No escribe nada.
- `generator:update` aplica solo operaciones seguras; sin `--apply` es dry-run puro; con conflictos o `requiresManual` no aplica; crea respaldo en `.api-starter/backups/<timestamp>/`; ejecuta validaciones posteriores allow-list (`typecheck` obligatoria; `lint`/`test` si el proyecto declara los scripts) con timeout 30 s y revierte automáticamente si fallan; registra cada `Update.id` en `manifest.appliedUpdates` solo tras éxito; es idempotente. **No existe `--force` global y `.env` nunca se toca.**
- `generator:adopt` crea el manifiesto para proyectos legacy con solo `GENERATED.md`: valida contra el catálogo, exige `--baseline` materializable, compara contra la baseline canónica (reporta `intact`/`customized`/`missing`) y solo escribe si es verificable.

## Migraciones y actualización

El actualizador **no** parchea `migrations/meta/_journal.json` ni ejecuta `db:migrate`. Migraciones nuevas o colisiones de journal se clasifican como `manual-migration` y bloquean `--apply`: la revisión y ejecución son manuales (ver [operations/migrations.md](../operations/migrations.md)).

## Límites conocidos del actualizador

- Solo la versión canónica del checkout es materializable; baselines históricos requieren snapshots.
- Merge estructurado solo para `package.json` / `apps/api/package.json` y `.env.example`; el resto de `structured` (`tsconfig.json`, `drizzle.config.ts`, `docker-compose.yml`, `packages/config/src/env.ts`) se clasifica como `conflict` con razón.
- Los proyectos generados no dependen en runtime de `api-starter`; el updater vive solo en `generator/src/*`.
- `dynamicRoles` permanece diferido por su conflicto con `authorization`.

## Siguiente paso

- [reference/cli.md](../reference/cli.md) — sintaxis completa de todos los comandos.
- [reference/profiles-and-features.md](../reference/profiles-and-features.md) — catálogo derivado.
- [guides/update-a-generated-project.md](../guides/update-a-generated-project.md) — flujo de actualización paso a paso.
