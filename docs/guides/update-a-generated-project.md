# Actualizar un proyecto generado

**Audiencia:** desarrollador con un proyecto generado por `api-starter`.
**Objetivo:** actualizar el proyecto a una versión nueva del starter **sin sobrescribir personalizaciones**.

> Esto es distinto de actualizar el repositorio `api-starter` (git pull del starter) y de añadir features (ver [add-a-feature.md](add-a-feature.md)). Esta guía actualiza **el proyecto generado** a una versión nueva del starter.

## El manifiesto: `.api-starter/manifest.json`

Todo proyecto generado registra qué archivos vienen del starter y su estado. El manifiesto guarda la versión del starter, las features seleccionadas y, por cada archivo, su hash SHA-256 y una estrategia:

| Estrategia | Significado |
|---|---|
| `managed` | El generador puede sobrescribirlo si no lo modificaste |
| `structured` | Tiene formato conocido y se actualiza con un merge conservador (`package.json`, `apps/api/package.json`, `.env.example`) |
| `scaffold` | Se crea una vez; el generador respeta tu contenido posterior |
| `ignored` | El generador no lo toca (`.env`, carpetas locales) |

Si tu proyecto se generó antes del manifiesto y solo tiene `GENERATED.md`, mira [adopt-a-legacy-project.md](adopt-a-legacy-project.md).

## Flujo para un proyecto ya gestionado

```
doctor → diff → revisar → update --apply → validar → commit
```

Todos los comandos se ejecutan **desde el checkout del starter** (el directorio `generator/` no existe en el proyecto generado). La versión objetivo es siempre la canónica del `package.json` del starter; `--to` es opcional y debe coincidir exactamente.

### 1. Doctor — diagnóstico sin modificar

```bash
bun run generator:doctor -- --project=../my-api
bun run generator:doctor -- --project=../my-api --json
```

Detecta: manifiesto ausente/inválido, versión desconocida, features inválidas o conflictivas, archivos gestionados faltantes o modificados, hashes desactualizados, migraciones no aplicadas, composición inconsistente y residuos de features deshabilitadas. El estado git sucio aparece como warning.

### 2. Diff — vista previa read-only

```bash
bun run generator:diff -- --project=../my-api
bun run generator:diff -- --project=../my-api --json
```

Materializa la versión canónica con las mismas features de tu proyecto y clasifica cada archivo: `add`, `update-safe`, `remove-safe`, `unchanged`, `customized-no-upstream-change`, `conflict` o `manual-migration`. No escribe nada. Con conflictos o migraciones manuales devuelve exit code distinto de cero.

### 3. Revisar

Si hay `conflict` o `manual-migration`, el diff explica por qué. **No uses un `--force` global**: no existe a propósito. Resuelve con fusión manual (ver [Resolución de conflictos](#resolución-de-conflictos)) y repite `doctor`/`diff` hasta que no queden conflictos.

### 4. Aplicar

```bash
bun run generator:update -- --project=../my-api              # dry-run (igual que diff)
bun run generator:update -- --project=../my-api --apply      # aplica los cambios seguros
```

Reglas de `update`:

- Sin `--apply` es dry-run puro.
- Solo aplica operaciones seguras (`add`, `update-safe`, `remove-safe`, merges `structured`).
- Con conflictos, migraciones manuales o `requiresManual`, **no aplica** por defecto.
- Crea un respaldo en `.api-starter/backups/<timestamp>/` (ignorado por Git).
- Ejecuta validaciones posteriores (typecheck obligatoria; lint/test si el proyecto declara los scripts) con timeout y revierte automáticamente si fallan; el manifiesto solo se actualiza tras éxito.
- Segunda ejecución es idempotente: los `Update` aplicados quedan registrados en `manifest.appliedUpdates`.

### 5. Validar

```bash
bun run generator:doctor -- --project=../my-api
cd ../my-api && bun run lint && bun run typecheck && bun test
bun run db:migrate   # si el diff incluía migraciones nuevas seguras
```

### 6. Commit

```bash
cd ../my-api
git add .
git commit -m "chore: update generated project to api-starter <versión>"
```

## Qué se actualiza solo y qué no

| Elemento | Comportamiento |
|---|---|
| Archivos `managed` sin modificar | Se actualizan automáticamente |
| `package.json` y `apps/api/package.json` | Merge conservador: solo toca dependencias `@consulting/*`, `drizzle-orm` y `drizzle-kit`; preserva scripts, deps ajenas y metadatos |
| `.env.example` | Merge por clave: preserva comentarios, orden y valores locales; añade claves nuevas al final |
| `.env` | **Nunca se toca** |
| Archivo local modificado + upstream sin cambios | Se conserva tu personalización |
| Archivo local modificado + upstream modificado | `conflict` — fusión manual |
| Migraciones nuevas o journal con colisión | `manual-migration` — revisión manual; bloquea `--apply` |
| `tsconfig.json`, `drizzle.config.ts`, `docker-compose.yml`, `packages/config/src/env.ts` | Sin merger seguro todavía: se clasifican como `conflict` con razón |

## Migraciones de base de datos

El actualizador **no** parchea `migrations/meta/_journal.json` ni ejecuta `db:migrate`. Las migraciones nuevas o conflictivas se clasifican como `manual-migration` y bloquean la aplicación: tú las revisas, fusionas manualmente y ejecutas `bun run db:migrate`. Ver [operations/migrations.md](../operations/migrations.md) y [operations/backup-and-restore.md](../operations/backup-and-restore.md).

## Resolución de conflictos

1. Abre el diff: `bun run generator:diff -- --project=../my-api --json` y lee `reason` y `strategy`.
2. Fusiona manualmente preservando tu personalización: en `package.json` conserva scripts y deps ajenas; en `.env.example` añade claves sin perder comentarios.
3. Para `manual-migration`, revisa la migración y el journal manualmente (runbook de migraciones).
4. Repite `doctor` y `diff` hasta que no haya conflictos.
5. Ejecuta `update --apply` y verifica con `doctor`.

Rollback: los respaldos de `.api-starter/backups/<timestamp>/` te permiten revertir cualquier aplicación; no hay `--force` global.

## Limitaciones conocidas

- Solo la versión canónica del checkout del starter es materializable; `--baseline` distinto de la canónica se rechaza hasta contar con snapshots históricos.
- Merge estructurado solo para `package.json` / `apps/api/package.json` y `.env.example`.
- Validaciones `lint`/`test` se omiten si el proyecto no declara esos scripts; `typecheck` es la única obligatoria por defecto.
- `migrations` y `_journal.json` no se parchean automáticamente.
- No hay descarga remota ni ejecución automática de `db:migrate`: todo se materializa desde el checkout local verificado.

## Siguiente paso

- [Adoptar un proyecto legacy](adopt-a-legacy-project.md) — proyectos sin manifiesto.
- [Agregar una feature](add-a-feature.md) — añadir capacidades, no versiones.
- [Referencia CLI](../reference/cli.md) — sintaxis completa y códigos de salida.
