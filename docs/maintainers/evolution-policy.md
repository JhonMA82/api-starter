# Política de evolución

**Audiencia:** mantenedores del starter.
**Objetivo:** qué entra y qué no entra al starter, y cómo evolucionar sin romper la fábrica.

La decisión normativa completa es el **ADR-0013** ([docs/decisions/0013-starter-evolution-and-update-policy.md](../decisions/0013-starter-evolution-and-update-policy.md), en inglés). Este documento es el resumen operativo; no duplica la decisión.

## Qué es y qué no es

- **Es:** una plantilla TypeScript + Hono + Bun con poda física por features, perfiles curados y tooling de generación/actualización. El código generado es propiedad del proyecto consumidor.
- **No es:** un framework privado obligatorio en runtime, un sistema de plugins dinámicos, un contenedor IoC ni un DSL.

## Clasificación de candidatos

| Clase | Ejemplos | Dónde vive |
|---|---|---|
| **A. Core** | errores, config, logging, seguridad HTTP, health, tooling | siempre presente |
| **B. Feature opcional** | auth, tenancy, jobs, webhooks, files, notifications | `generator/features.json` + `modules/*`/`packages/*` |
| **C. Receta / integración** | wiring de proveedor, ejemplos frontend, config de despliegue | `integrations/` o recetas documentadas |
| **D. Dominio de producto** | pedidos, inventario, facturación específica | proyecto consumidor, nunca el starter |

## Puerta de admisión

Toda feature nueva debe pasar los 10 puntos de [feature-proposal-template.md](feature-proposal-template.md): transversal, segundo caso real, podable físicamente, contratos explícitos, sin imports inversos, pruebas (unit + integración + generador), actualización/migración para proyectos existentes, documentación y operación, responsable o criterio de retirada, y sin abstracción general prematura.

## Prohibiciones (resumen)

- Sin feature flags de runtime: poda física obligatoria.
- Sin sobrescritura silenciosa de personalizaciones: ante duda, conflicto y no escribir.
- Sin `--force` global destructivo en el actualizador.
- Sin plugins dinámicos, IoC, service locator ni DSL.
- `db:migrate` nunca se ejecuta automáticamente desde el generador.

## Presupuesto de complejidad

El starter debe permanecer pequeño, legible y con los límites `domain ← application ← http` intactos. Cada incorporación justifica su costo de mantenimiento; la complejidad no se añade por conveniencia de un solo proyecto.

## Siguiente paso

- [feature-proposal-template.md](feature-proposal-template.md) — plantilla para proponer.
- [development.md](development.md) — cómo implementar una feature aprobada.
- [releases-and-versioning.md](releases-and-versioning.md) — cómo versionar la evolución.
