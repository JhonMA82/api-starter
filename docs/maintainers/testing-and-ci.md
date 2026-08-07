# Pruebas y CI

**Audiencia:** mantenedores del starter.
**Objetivo:** ejecutar las suites, reproducir localmente cada job de CI y declarar un release validado con evidencia.

## Suites

### Rápida sin DB (hermética)

```bash
bun test              # unidades, rutas, middleware, contratos, SDK, generador, scripts
bun run lint          # biome ci .
bun run typecheck     # bun x tsc --noEmit
bun test --coverage   # umbral global 0.8 (bunfig.toml)
```

Los tests que requieren base de datos real se **saltan** si `DATABASE_URL` no está definido.

### Con PostgreSQL real

```bash
bun run db:up                                  # postgres 17 (contenedor api-pg)
bun run db:migrate
DATABASE_URL=postgres://postgres:postgres@localhost:5432/api bun test --parallel=1
```

`--parallel=1` es obligatorio: las suites de DB resetean esquemas y deben correr serializadas. Cubren auth, autorización, auditoría, tenancy, integraciones, archivos, notificaciones, migraciones y los scripts de backup/restore.

### Contrato OpenAPI

```bash
bun test apps/api/tests/openapi.test.ts        # toda ruta documentada
```

### Generador

```bash
bun run generator:validate                     # catálogo válido
bun test generator/tests                       # validación, poda, e2e, registry, manifiesto
```

### Drift de migraciones

```bash
bun run db:generate && git diff --exit-code    # gate de drift (migrations-check)
```

## Jobs de CI y cómo reproducirlos

`.github/workflows/ci.yml` ejecuta 8 jobs en cada pull request, todos con acciones fijadas por tag completo y `bun install --frozen-lockfile`:

| Job | Comando equivalente local |
|---|---|
| `lint` | `bun run lint` |
| `typecheck` | `bun x tsc --noEmit` |
| `test` | `bun test --coverage` |
| `openapi-validation` | `bun test apps/api/tests/openapi.test.ts` |
| `docker-build` | `docker build .` (o `podman build .`) |
| `migrations-check` | `bun run db:generate && git diff --exit-code` |
| `integration-test` | `DATABASE_URL=... bun test --parallel=1` (servicio `postgres:17-alpine`) |
| `migration-test` | tests de migración reales sobre el servicio postgres de CI |
| `docs` | `bun run docs:check` (enlaces y coherencia de documentación) |

Evidencia de la última validación completa del repositorio: [archive/verification-reports/final-validation-0.10.0.md](../archive/verification-reports/final-validation-0.10.0.md) (v0.10.0, 2026-08-03). No se afirma que CI esté verde sin registrar la ejecución correspondiente.

## Cobertura

- Umbral **0.8 por archivo** (`bunfig.toml`).
- Los ignores de cobertura cubren exclusivamente infraestructura ejercitada por las suites de DB reales (la cobertura sin DB no puede medir paths que requieren PostgreSQL).
- La cobertura es un control de regresión, no un sustituto de las pruebas de aislamiento, IDOR e invariantes.

## Criterio para declarar un release validado

- Los 8+ jobs de CI verdes (o sus equivalentes locales ejecutados y registrados).
- `generator:validate` + `generator:sync` limpios; un proyecto de prueba generado, actualizado y doctorado sin conflictos.
- Drift de migraciones cero (`db:generate` + `git diff --exit-code`).
- Documentación coherente: `bun run docs:check`.
- Changelog y versión alineados en todos los manifests.
