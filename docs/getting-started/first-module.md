# Primer módulo

**Audiencia:** desarrollador que trabaja en un proyecto generado.
**Objetivo:** añadir un módulo de dominio respetando la estructura por capas, sin convertir la guía en una aplicación completa.

## Estructura por capas

Cada módulo sigue la tríada `domain ← application ← http` (la dirección de dependencias apunta hacia dentro):

```
modules/customers/
├─ src/domain/            lógica pura: entidades, errores, reglas (sin Hono, sin Bun, sin E/S)
├─ src/application/       orquestación: servicios, puertos (ports) e interfaces
├─ src/http/              rutas Hono, schemas zod, respuestas RFC 9457
├─ src/infrastructure/    adaptadores: esquema Drizzle, repositorio, mapper
├─ src/index.ts           exports públicos del módulo
└─ tests/                 pruebas del módulo
```

Responsabilidades:

| Capa | Qué hace | Qué NO debe importar |
|---|---|---|
| `domain` | reglas de negocio puras | Hono, Bun, Drizzle, infraestructura |
| `application` | casos de uso, puertos | Hono, Bun |
| `http` | rutas, validación zod, problem+json | nada de `domain` inverso; es la única que conoce el framework |
| `infrastructure` | persistencia y adaptadores | framework HTTP |

Una regla práctica: si una regla de negocio no puede ejecutarse sin una base de datos o un servidor HTTP, está en la capa equivocada.

## Generar el esqueleto con `create:module`

El comando se ejecuta **desde el repositorio del starter** (el directorio `generator/` no se copia al proyecto generado), apuntando al proyecto con `--out`:

```bash
# en el checkout de api-starter:
bun run create:module -- --name=customers --scope=global --crud --out=../my-api/modules
```

Opciones: `--scope=global|user|tenant` (tenant añade el cableado multi-tenant), `--crud`, `--events` (eventos de dominio), `--audit`. El esqueleto genera 13 archivos (entidad, errores, servicio, puertos, esquema zod, rutas, repositorio, mapper, schema Drizzle, exports y tests).

## Qué es generado y qué requiere implementación humana

| Archivo | Estado tras generar |
|---|---|
| `src/domain/customers.entity.ts` | esqueleto: la entidad y sus reglas son **tuyas** |
| `src/domain/customers.errors.ts` | esqueleto: añade los errores de negocio |
| `src/application/customers-service.ts` | implementación de los casos de uso: **tuya** |
| `src/application/ports.ts` | interfaz del repositorio: ajusta a tu modelo |
| `src/infrastructure/customers.schema.ts` | esquema Drizzle: define columnas; después `bun run db:generate` |
| `src/infrastructure/customers.repository.ts` | implementación del puerto: **tuya** |
| `src/http/schemas.ts` + `customers.routes.ts` | schemas zod y rutas: ajusta a tu contrato |
| `tests/customers.test.ts` | pruebas: escribe casos reales |

El módulo de referencia ya implementado es `modules/notes` (misma estructura, con persistencia real): úsalo como ejemplo en lugar de copiar cientos de líneas.

## Registrar el módulo en la app

En un proyecto generado, el módulo se cablea en la aplicación:

1. `bun install` — el workspace se resuelve desde `modules/customers`.
2. Monta las rutas en `apps/api/src/routes.ts` (o en el punto de composición del proyecto) y, si el módulo usa DB, crea la migración con `bun run db:generate` + revisa el SQL, luego `bun run db:migrate`.

## Validaciones finales

```bash
bun run lint      # biome ci .
bun run typecheck # bun x tsc --noEmit
bun test          # suite del proyecto
```

Contrato OpenAPI (si tu proyecto lo valida): `bun test apps/api/tests/openapi.test.ts`.

## Siguiente paso

- [Guías: agregar una feature](../guides/add-a-feature.md) — si lo que necesitas es una capacidad transversal, no un módulo de negocio.
- [Arquitectura: capas y límites](../architecture/layers-and-boundaries.md) — reglas completas de imports y ownership.
