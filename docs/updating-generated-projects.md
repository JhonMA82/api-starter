# Actualización de Proyectos Generados

Esta guía describe cómo diagnosticar y actualizar un proyecto generado con `api-starter` sin sobrescribir personalizaciones.

## Resumen del flujo

```
generar → personalizar → doctor → diff → update --apply → verificar → idempotencia
```

El actualizador es un **motor de materialización y comparación de tres vías** con validación de ruta versionada. No es una copia ciega ni un framework de runtime.

## Versión objetivo

La versión canónica proviene **únicamente** del `package.json` del checkout del starter (resuelto vía `generator/src/starter-version.ts`), no del `process.cwd()` del proyecto consumidor. `generator:diff` y `generator:update` aceptan `--to` opcional: si se omite, asumen la canónica; si se pasa, debe coincidir exactamente o se rechaza antes de materializar. El `manifest.starter.version`, la salida JSON `toVersion` y `UpdatePlan.toVersion` siempre reflejan la canónica verificada, nunca un valor ficticio del usuario. No hay descarga remota de tags.

## Comandos

### `generator:doctor`

Diagnostica sin modificar:

```bash
bun run generator:doctor -- --project=../my-api
bun run generator:doctor -- --project=../my-api --json
```

Detecta: manifiesto ausente/inválido, esquema no soportado, versión desconocida, features inválidas/conflictivas, archivo gestionado faltante/modificado, hashes desactualizados, migraciones no aplicadas, composición inconsistente, residuos de features deshabilitadas, estado git sucio (warning).

### `generator:diff`

Vista previa read-only contra la versión canónica:

```bash
bun run generator:diff -- --project=../my-api
bun run generator:diff -- --project=../my-api --to=0.11.0
bun run generator:diff -- --project=../my-api --to=0.11.0 --json
```

Materializa la versión canónica usando exactamente las mismas features del proyecto, clasifica cada operación como `add`/`update-safe`/`remove-safe`/`unchanged`/`customized-no-upstream-change`/`conflict`/`manual-migration`, valida la ruta `resolveUpdatePath(from, canonical)` (rechaza saltos incompletos, downgrades y `requiresManual`), expone en dry-run los `updatePath` con `id`, `breakingNotes`, `requiresManual` y `postValidations`, explica por qué es conflicto, y devuelve exit code no cero si hay conflictos, migraciones manuales o ruta inválida. No escribe en el proyecto ni ejecuta validaciones en dry-run.

### `generator:update`

Aplica cambios seguros:

```bash
bun run generator:update -- --project=../my-api               # dry-run (como diff)
bun run generator:update -- --project=../my-api --to=0.11.0          # dry-run con verificación de versión
bun run generator:update -- --project=../my-api --apply # aplica a la canónica
bun run generator:update -- --project=../my-api --to=0.11.0 --apply # aplica con --to verificado
```

Políticas: sin `--apply` es dry-run puro; no sobrescribe archivos modificados; no hay `--force` global; con conflictos, `manual-migration` o `requiresManual` no aplica por defecto; crea respaldo en `.api-starter/backups/<timestamp>/` (ignorado por Git); aplica determinísticamente ordenado por path; ejecuta validaciones posteriores allow-list (ver abajo) y revierte automáticamente si fallan sin bumpear el manifiesto; registra cada `Update.id` una vez en `manifest.appliedUpdates` solo tras éxito; segunda ejecución es idempotente.

### `generator:adopt`

Migra un proyecto legacy con solo `GENERATED.md`:

```bash
bun run generator:adopt -- --project=../legacy-api --baseline=0.11.0
```

Lee el marcador antiguo solo como entrada de migración, valida perfil/features, exige que `--baseline` sea materializable desde el checkout actual (hoy solo la canónica `0.11.0`; históricos requieren snapshots), compara contra la baseline materializada, almacena `baselineHash` canónico (no el hash local personalizado) con `strategy` real (`getFileStrategy`), reporta `intact`/`customized`/`missing` y crea `.api-starter/manifest.json` solo si es verificable. No adivina la baseline.

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
| migración nueva/modificada o colisión de journal | `manual-migration` (bloquea `--apply`) |

## Archivos estructurados (soporte real)

- `package.json` y `apps/api/package.json`: merge conservador JSON que solo toca claves administradas (`dependencies`/`devDependencies` para `@consulting/*`, `drizzle-orm`, `drizzle-kit`), preserva scripts, dependencias ajenas, nombre y metadatos del proyecto. JSON inválido bloquea la actualización y activa rollback.
- `.env.example`: merge por clave preservando comentarios, orden y valores locales; nuevas claves canónicas se añaden al final sin duplicar; nunca toca `.env`.
- **Otros `structured` sin parser seguro** (`tsconfig.json`, `drizzle.config.ts`, `docker-compose.yml`, `packages/config/src/env.ts`): hoy no se mergean heurísticamente; se clasifican como `conflict` con razón y requieren fusión manual hasta contar con parser/región generada dedicado.

## Migraciones de base de datos (alcance real)

El actualizador **no** parchea automáticamente `migrations/meta/_journal.json` ni ejecuta `db:migrate`. Nuevos ficheros `migrations/*.sql` o cambios en el journal que impliquen colisión de nombre/hash, eliminación con personalización o tenancy se clasifican como `manual-migration` y bloquean `--apply`. El usuario debe revisar, fusionar manualmente y ejecutar `bun run db:migrate` explícitamente. Ver `docs/migrations-runbook.md` y `docs/backup-restore.md` para backup/rollback. Una automatización segura de journal queda para un cambio futuro con diseño dedicado.

## Validaciones posteriores (allow-list)

`generator:update --apply` ejecuta, con timeout 30s por validación y captura de `stdout/stderr`:

- `typecheck` → `bun x tsc --noEmit` (obligatorio)
- `lint` → `bun run lint` (si `package.json` del proyecto declara script `lint`)
- `test` → `bun test --bail` (si declara `test`)
- `manifest` → `validateManifest` (si el registry lo declara en `postValidations`)
- `generator-smoke` → `bun run generator:validate` (si lo declara)

Además, `registry.postValidations` de cada `Update` se une a la lista base tras filtrar por el allow-list. Cualquier fallo indica `failedId`, dispara rollback de archivos y manifiesto, y deja el reporte. Dry-run nunca ejecuta validaciones.

## Resolución de conflictos

Un `conflict` o `manual-migration` significa que tu archivo divergió y el starter también cambió, o que no hay merger seguro. Pasos:

1. Abre el diff: `bun run generator:diff -- --project=../my-api --json`
2. Lee `reason` y `strategy`
3. Fusiona manualmente preservando tu personalización; para `package.json` conserva scripts/deps ajenos, para `.env.example` añade claves sin perder comentarios
4. Para `manual-migration`, revisa la migración y el journal manualmente y sigue `docs/migrations-runbook.md`
5. Vuelve a ejecutar `doctor` y `diff` hasta que no haya conflictos
6. Ejecuta `update --apply` y verifica con `doctor`

No uses `--force`; el respaldo en `.api-starter/backups/` permite revertir.

## Versionado y registry

Si tu proyecto está en `0.10.1` y actualizas a `0.11.0`, el registry resuelve `0.10.1 → 0.11.0` secuencialmente vía `resolveUpdatePath`. Saltos incompletos, downgrades o `requiresManual` sin confirmación segura se rechazan antes de escribir. Cada `Update.id` aplicado se registra una vez en `manifest.appliedUpdates`; re-ejecutar es no-op.

`STARTER_VERSION` y `createManifest` derivan de la misma fuente canónica (`package.json` del repo); un test `generator/tests/version-sync.test.ts` falla si divergen.

## Limitaciones conocidas

- Solo la versión canónica del checkout actual es materializable; `adopt --baseline` distinto de la canónica es rechazado hasta contar con snapshots/fixtures históricos.
- Merge estructurado solo para `package.json` / `apps/api/package.json` y `.env.example`; el resto de `structured` requiere intervención manual.
- Validaciones `lint`/`test` se omiten si el proyecto no declara esos scripts; `typecheck` es la única obligatoria por defecto.
- `migrations` y `_journal.json` no se parchean automáticamente; se bloquean como `manual-migration`.
- No hay descarga remota ni ejecución automática de `db:migrate`; todas las actualizaciones son desde el checkout local verificado.
- El proyecto generado no depende en runtime de `api-starter`; el updater vive solo en `generator/src/*`.
