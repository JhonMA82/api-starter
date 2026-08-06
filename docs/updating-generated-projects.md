# Actualización de Proyectos Generados

Esta guía describe cómo diagnosticar y actualizar un proyecto generado con `api-starter` sin sobrescribir personalizaciones.

## Resumen del flujo

```
generar → personalizar → doctor → diff → update --apply → verificar → idempotencia
```

El actualizador es un **motor de materialización, comparación y migraciones versionadas**, no una copia ciega.

## Comandos

### `generator:doctor`

Diagnostica sin modificar:

```bash
bun run generator:doctor -- --project=../my-api
bun run generator:doctor -- --project=../my-api --json
```

Detecta: manifiesto ausente/inválido, esquema no soportado, versión desconocida, features inválidas/conflictivas, archivo gestionado faltante/modificado, hashes desactualizados, migraciones no aplicadas, composición inconsistente, residuos de features deshabilitadas, estado git sucio (warning).

### `generator:diff`

Vista previa read-only contra una versión objetivo:

```bash
bun run generator:diff -- --project=../my-api --to=0.11.0
bun run generator:diff -- --project=../my-api --to=0.11.0 --json
```

Materializa la versión canónica usando exactamente las mismas features del proyecto (no solo el nombre del perfil), clasifica cada operación como `add`/`update-safe`/`remove-safe`/`unchanged`/`customized-no-upstream-change`/`conflict`/`manual-migration`, explica por qué es conflicto, y devuelve exit code no cero si hay conflictos.

### `generator:update`

Aplica cambios seguros:

```bash
bun run generator:update -- --project=../my-api --to=0.11.0          # dry-run (como diff)
bun run generator:update -- --project=../my-api --to=0.11.0 --apply # aplica
```

Políticas: sin `--apply` es dry-run; no sobrescribe archivos modificados; no hay `--force` global; con conflictos no aplica por defecto; crea respaldo en `.api-starter/backups/<timestamp>/`; aplica determinísticamente; ejecuta validaciones posteriores (`typecheck`/`test`); revierte automáticamente si fallan y no bumpa el manifiesto; segunda ejecución es idempotente.

### `generator:adopt`

Migra un proyecto legacy con solo `GENERATED.md`:

```bash
bun run generator:adopt -- --project=../legacy-api --baseline=0.10.1
```

Lee el marcador antiguo solo como entrada de migración, valida perfil/features, compara contra la baseline indicada, genera reporte y crea `.api-starter/manifest.json` solo si es verificable. No adivina la baseline.

## Comparación segura de archivos

| Estado | Acción |
|---|---|
| actual = hash base y nuevo canónico diferente | `update-safe` |
| actual = nuevo canónico | `unchanged` |
| actual diferente del hash base y upstream no cambió | conservar personalización |
| actual diferente y upstream también cambió | `conflict` |
| nuevo en objetivo y no existe local | `add` |
| eliminado upstream y local = hash base | `remove-safe` |
| eliminado upstream y local modificado | `conflict` |

## Archivos estructurados

- `package.json`: parsea y actualiza solo claves administradas (`@consulting/*`, `drizzle-*`), preserva scripts y deps ajenas.
- `.env.example`: por nombre de variable; nunca toca `.env`.
- `docker-compose.yml`/`drizzle.config.ts`: vía parser real o regiones generadas, no regex frágil.

## Migraciones de base de datos

El actualizador añade archivos de migración y parchea `migrations/meta/_journal.json` determinísticamente, detecta colisiones, y genera plan manual para cambios de tenancy/datos. **No ejecuta** `db:migrate` automáticamente; requiere `bun run db:migrate` explícito. Ver `docs/migrations-runbook.md` y `docs/backup-restore.md` para backup/rollback.

## Resolución de conflictos

Un `conflict` significa que tu archivo local divergió y el starter también cambió ese archivo. Pasos:

1. Abre el diff: `bun run generator:diff -- --project=../my-api --to=0.11.0`
2. Lee la razón del conflicto (hash base vs actual vs canónico)
3. Fusiona manualmente: copia los cambios del canónico (`materializeToTemp` te da la versión esperada) preservando tu personalización
4. Actualiza el hash base en `.api-starter/manifest.json` para marcarlo como resuelto (o espera al siguiente `update` que lo hará tras tu fusión)
5. Vuelve a ejecutar `doctor` y `diff` hasta que no haya conflictos
6. Ejecuta `update --apply` y verifica con `doctor`

No uses `--force` para ignorar conflictos; el respaldo en `.api-starter/backups/` te permite revertir si algo sale mal.

## Versionado

Si tu proyecto está en `0.10.1` y actualizas a `0.11.0`, el registry ejecuta `0.10.1 → 0.11.0` secuencialmente. Saltos incompletos se rechazan. Cada actualización aplicada se registra en `manifest.appliedUpdates`.
