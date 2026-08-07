# Adoptar un proyecto legacy

**Audiencia:** desarrollador con un proyecto generado por una versión antigua del starter que solo tiene `GENERATED.md` (sin `.api-starter/manifest.json`).
**Objetivo:** crear el manifiesto para que el proyecto entre en el flujo `doctor`/`diff`/`update`.

## Cuándo usar esta guía

- El proyecto tiene `GENERATED.md` pero no `.api-starter/manifest.json`.
- `add:feature` o `generator:doctor` te avisan de que falta el manifiesto.

## Flujo

```
adopt → revisar baseline → crear manifiesto → doctor → diff
```

### 1. Adoptar

```bash
bun run generator:adopt -- --project=../legacy-api --baseline=0.11.0
```

Reglas de `adopt`:

- Lee el marcador `GENERATED.md` antiguo **solo como entrada** de migración; no confía en él como verdad.
- Valida perfil/features contra el catálogo.
- Exige `--baseline` materializable desde el checkout actual (hoy solo la canónica; versiones históricas requieren snapshots).
- Materializa la baseline y compara cada archivo, reportando `intact` / `customized` / `missing`.
- Almacena `baselineHash` **canónico** (no el hash local personalizado) y la estrategia real del archivo.
- Crea `.api-starter/manifest.json` **solo si es verificable**. No adivina la baseline: si no es materializable, falla en lugar de inventar.

### 2. Revisar el reporte

`adopt` no modifica tus archivos: solo crea el manifiesto. Revisa las clasificaciones `customized`/`missing`: te dicen qué personalizaciones quedan fuera de la baseline y qué archivos faltan respecto a la versión de referencia.

### 3. Doctor y diff

```bash
bun run generator:doctor -- --project=../legacy-api
bun run generator:diff -- --project=../legacy-api
```

Si la baseline canónica difiere de tu estado real, aparecerán actualizaciones y posibles conflictos: resuélvelos como en [update-a-generated-project.md](update-a-generated-project.md).

## Siguiente paso

- [Actualizar un proyecto generado](update-a-generated-project.md) — flujo completo una vez adoptado.
- [Referencia CLI](../reference/cli.md) — sintaxis completa.
