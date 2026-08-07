# Agregar una feature

**Audiencia:** desarrollador que trabaja en un proyecto generado.
**Objetivo:** añadir una capacidad transversal (por ejemplo `files` o `notifications`) a un proyecto existente.

## Cuándo usar esta guía

- Añadir una **feature del catálogo** (ver [reference/profiles-and-features.md](../reference/profiles-and-features.md)) a un proyecto generado.
- Distinto de: crear un módulo de negocio (`create:module`, ver [first-module.md](../getting-started/first-module.md)) y de actualizar a una versión nueva del starter ([update-a-generated-project.md](update-a-generated-project.md)).

## Flujo

El comando se ejecuta **desde el repositorio del starter** (el directorio `generator/` no existe en el proyecto generado):

```bash
# en el checkout de api-starter:
bun run add:feature -- --feature=files --project=../my-api
```

Si la feature tiene requisitos no satisfechos, el generador los lista y se resuelven automáticamente con:

```bash
bun run add:feature -- --feature=files --project=../my-api --with-requires
```

`multitenancy` es un alias aceptado de `tenancy`.

## Qué hace

- Calcula las dependencias transitivas (p. ej. `webhooks` exige `tenancy` y `jobs`).
- Copia al proyecto los módulos, paquetes, migraciones y configuración de la feature, y actualiza `.api-starter/manifest.json`.
- Escribe `FEATURE_PLAN.md` en el proyecto con el plan aplicado.
- Respeta los archivos custom: los archivos protegidos por marcadores **no se sobrescriben**; falla de forma segura con destinos no vacíos y archivos modificados. `--force` hace explícita la recreación o sobrescritura.

## Caso: añadir tenancy a un proyecto existente

Añadir `tenancy` a un proyecto que ya tiene datos **no es automático**: el generador muestra una advertencia y escribe un plan de migración de datos para tu revisión, pero **nunca ejecuta** ese plan ni toca datos. La migración es tuya: revísala y aplícala con `bun run db:migrate` después de revisar el SQL.

## Después de añadir

```bash
bun install                       # resuelve los nuevos workspaces
bun run db:migrate                # aplica las migraciones nuevas de la feature
bun run lint && bun run typecheck && bun test
bun run generator:doctor -- --project=../my-api   # si quieres revalidar el proyecto
```

## Impacto a tener en cuenta

- Nuevas variables de entorno: `.env.example` del proyecto se actualiza; copia al `.env` solo lo que decidas habilitar (nunca edites `.env` a mano si el generador lo gestiona).
- Nuevos endpoints: los verás en `/openapi.json` y `/docs`.
- La feature puede traer migraciones nuevas: lee `migrations/` antes de migrar.

## Siguiente paso

- [Actualizar un proyecto generado](update-a-generated-project.md) — para actualizar la versión del starter, no para añadir features.
- [Referencia: perfiles y features](../reference/profiles-and-features.md) — catálogo completo con dependencias.
