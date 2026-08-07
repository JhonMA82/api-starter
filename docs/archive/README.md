# Histórico y trazabilidad

> Estos documentos conservan contexto histórico y evidencia de implementación. No son la fuente vigente de uso, arquitectura ni operación.

## Contenido

| Documento | Qué es | Por qué está aquí |
|---|---|---|
| [original-specification.md](original-specification.md) | Especificación original del starter escrita para OpenCode (2324 líneas) | Contexto histórico; reemplazada por `docs/README.md`, la arquitectura y las guías actuales |
| [verification-reports/final-validation-0.10.0.md](verification-reports/final-validation-0.10.0.md) | Reporte de validación final del starter 0.10.0 | Evidencia cerrada de una versión anterior; no describe el estado actual |
| [verification-reports/update-system-vnext-2026-08-06.md](verification-reports/update-system-vnext-2026-08-06.md) | Verificación del sistema doctor/diff/update (vNext) | Evidencia cerrada de implementación |
| [verification-reports/load-test-results-2026-08-03.md](verification-reports/load-test-results-2026-08-03.md) | Resultados de carga del 2026-08-03 | Medición puntual en una máquina local; no es una garantía de rendimiento |

## Carpetas internas de herramientas

- `docs/openspec/` — cambios y especificaciones gestionadas por la herramienta OpenSpec. La herramienta depende de las rutas exactas; no se mueven. Solo mantenedores.
- `docs/superpowers/` — planes, diseños y reportes del flujo de trabajo Superpowers. Solo mantenedores.

Ambas quedan fuera del índice de onboarding ([`docs/README.md`](../README.md)).

## Reglas

- No archivar ADR vigentes: las decisiones normativas viven en `docs/decisions/`.
- No borrar evidencia histórica salvo duplicados exactos sin valor.
- Los reportes de validación nuevos se añaden aquí, con fecha en el nombre.
