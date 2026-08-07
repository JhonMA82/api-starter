# Reporte de refactorización de documentación

**Fecha:** 2026-08-06 · **Versión del starter:** 0.11.0 · **Audiencia:** mantenedores.

Refactor de la arquitectura de información del repositorio: el README pasó de manual completo a página de aterrizaje, y la documentación se reorganizó por audiencia y tarea con históricos claramente separados.

## Inventario inicial

| Archivo | Líneas | Clasificación previa |
|---|---|---|
| `README.md` | 208 | Manual completo: capacidades + env + endpoints + Docker + CI + estructura + índice |
| `docs/architecture.md` | 163 | Arquitectura + catálogo de capabilities + operación |
| `docs/updating-generated-projects.md` | 126 | Guía de actualización (normativa) |
| `docs/migrations-runbook.md` | 63 | Runbook operativo |
| `docs/backup-restore.md` | 134 | Runbook operativo |
| `docs/load-test.md` | 102 | Runbook operativo |
| `docs/load-test-results.md` | 120 | Medición histórica puntual |
| `docs/threat-model.md` | 127 | Seguridad (vigente) |
| `docs/feature-proposal-template.md` | 55 | Gobernanza (vigente) |
| `docs/OPENCODE_HONO_BACKEND_REUTILIZABLE.md` | 2324 | Especificación original (histórico) |
| `docs/verification-generated-project-update-vnext.md` | 33 | Reporte de verificación cerrado |
| `VALIDATION_REPORT.md` (raíz) | 280 | Reporte de validación cerrado (v0.10.0) |
| `docs/decisions/` (13 ADR) | — | Normativo (vigente) |
| `docs/openspec/`, `docs/superpowers/` | — | Tooling interno de herramientas |

## Hallazgos verificados

| # | Hallazgo | Evidencia | Tratamiento |
|---|---|---|---|
| 1 | README mezcla audiencias (usuario vs mantenedor) | El primer ejemplo arranca el repo, no genera una API; env/endpoints/Docker/CI/estructura en una sola página | README → landing con dos caminos; lo factual movido a `docs/reference/` |
| 2 | Sin ruta de onboarding única | No existía `elegir perfil → generar → instalar → arrancar → primer módulo → validar → commit` | `docs/getting-started/` (3 guías) |
| 3 | Históricos mezclados con normativos | Espec original de 2324 líneas, reportes de validación y verificación en rutas primarias | `docs/archive/` con banners no normativos |
| 4 | Versiones obsoletas | `consulting-api:0.10.1` en README; `APP_VERSION` default `0.10.1` en `packages/config`; `.env.example`/`.env.test.example` en `0.10.1`; Docker `IMAGE_VERSION` en `0.10.1` | Alineadas a `0.11.0` (package.json) |
| 5 | Perfiles con "spec §..." en `generator/profiles.json` / `features.json` | Descripciones del catálogo | **Deuda:** el catálogo es fuente de verdad del generador y los cambios de catálogo están fuera de alcance; la documentación humana ya no usa "spec §" |
| 6 | Deprecación incoherente de `multi-tenant` | `profiles.json` dice "reconsiderado en 0.11.0"; CHANGELOG 0.11.0 dice "0.12.0" | **Deuda:** corregir el texto de `deprecatedReason` en un cambio de catálogo |
| 7 | README afirmaba `APP_VERSION` default `0.1.0` | El código usaba `0.10.1` | Corregido al escribir `reference/environment.md` (default = versión de package.json) |
| 8 | Enlaces de código a rutas viejas | `Dockerfile`, `scripts/db/backup.ts`/`restore.ts`, `AGENTS.md`, ADR-0012/0013 | Migrados |
| 9 | Generador excluía el spec por basename | `EXCLUDED_BASENAMES` con `OPENCODE_HONO_BACKEND_REUTILIZABLE.md` | Renombrado a `original-specification.md` (mismo comportamiento) |
| 10 | Sin comprobación automática de enlaces/coherencia | No existía `docs:check` | `scripts/check-docs.ts` + job `docs` en CI |

## Mapa antiguo → nuevo

| Antes | Después |
|---|---|
| `README.md` (manual) | `README.md` (landing) + `docs/README.md` (índice) |
| `docs/architecture.md` | `docs/architecture/overview.md`, `layers-and-boundaries.md`, `capabilities.md`, `generator-and-managed-files.md` |
| `docs/updating-generated-projects.md` | `docs/guides/update-a-generated-project.md` + `docs/guides/adopt-a-legacy-project.md` |
| `docs/migrations-runbook.md` | `docs/operations/migrations.md` |
| `docs/backup-restore.md` | `docs/operations/backup-and-restore.md` |
| `docs/load-test.md` | `docs/operations/load-testing.md` |
| `docs/load-test-results.md` | `docs/archive/verification-reports/load-test-results-2026-08-03.md` |
| `docs/threat-model.md` | `docs/security/threat-model.md` |
| `docs/feature-proposal-template.md` | `docs/maintainers/feature-proposal-template.md` |
| `docs/OPENCODE_HONO_BACKEND_REUTILIZABLE.md` | `docs/archive/original-specification.md` |
| `docs/verification-generated-project-update-vnext.md` | `docs/archive/verification-reports/update-system-vnext-2026-08-06.md` |
| `VALIDATION_REPORT.md` (raíz) | `docs/archive/verification-reports/final-validation-0.10.0.md` |
| — (nuevo) | `docs/getting-started/` (3 guías), `docs/guides/add-a-feature.md`, `docs/reference/` (5 páginas), `docs/maintainers/` (5 páginas), `docs/archive/README.md`, `docs/archive/documentation-refactor-report.md` |

## Contradicciones corregidas

- Versión del starter y defaults alineados a `0.11.0` (README Docker, `APP_VERSION`, `.env.example`, Docker `IMAGE_VERSION`).
- `reference/environment.md` describe el esquema real (`env.ts`), no el README antiguo (default `APP_VERSION` incorrecto).
- `reference/profiles-and-features.md` deriva el catálogo de `profiles.json`/`features.json` y lo verifica con `docs:check`.
- README ya no describe la API completa del repo como si fuera lo que incluye cada perfil generado.

## Documentos archivados y motivo

| Documento | Motivo |
|---|---|
| `original-specification.md` | Especificación de implementación de 2324 líneas; sustituida por la documentación vigente |
| `final-validation-0.10.0.md` | Reporte de validación cerrado de una versión anterior |
| `update-system-vnext-2026-08-06.md` | Verificación cerrada de implementación (sistema de actualización) |
| `load-test-results-2026-08-03.md` | Medición puntual en máquina local; no es garantía de rendimiento |

`docs/openspec/` y `docs/superpowers/` no se movieron: las herramientas dependen de rutas exactas (verificado: `docs/openspec/config.yaml`, biome ignora ambas). Quedan etiquetadas como internas en `docs/archive/README.md` y fuera del índice de onboarding.

## Enlaces verificados

- Todos los enlaces Markdown internos comprobados con `bun run docs:check` (rutas existentes).
- Referencias actualizadas: `AGENTS.md` (3), ADR-0012 (3), ADR-0013 (3), `Dockerfile` (1), `scripts/db/backup.ts`/`restore.ts` (2), `generator/src/create-project.ts` (basename del spec archivado).
- Las entradas históricas de `CHANGELOG.md` conservan sus rutas originales (registro del pasado; no se reescriben).

## Comandos ejecutados

- `bun run docs:check` — ok.
- `bun run generator:validate` — ok.
- `bun run lint`, `bun run typecheck`, `bun test` — ver sección de verificación final del reporte de la PR.
- `bun run create:project -- --profile=minimal --out=/tmp/...` — generación de prueba (verifica el quickstart y la exclusión del spec archivado).
- `git diff --check` — limpio.

## Riesgos y deuda pendiente

- **Deuda (catálogo):** descripciones con "spec §..." en `generator/profiles.json` y `generator/features.json`; incoherencia `0.11.0` vs `0.12.0` en `deprecatedReason` de `multi-tenant`. Cambios de catálogo fuera de alcance de este refactor.
- **Deuda (generador):** los proyectos generados conservan los scripts `generator:*`/`create:*` en su `package.json` aunque `generator/` no se copia (comportamiento preexistente; documentado en `reference/repository-structure.md`).
- **Nota:** los archivos `OPENCODE_*.md` de la raíz (prompts de trabajo, no trackeados) se conservan sin enlazar; no forman parte de la documentación.
- Los proyectos generados copian `docs/` completo; la nueva estructura les aplica igualmente, salvo el spec archivado que se excluye por basename.
