# ADR-0013: Starter Evolution and Update Policy

- Status: Accepted
- Date: 2026-08-06
- Scope: Evolución del starter sin convertirlo en framework (Parte E del PRD)

## Context

`api-starter` es una **fábrica de APIs independientes**, no un framework privado. Sin criterios estrictos, cada necesidad de un proyecto podría incorporarse al repo central, aumentando acoplamiento y dificultando actualizaciones. Se requiere una política explícita de admisión y una estrategia de actualización segura, versionada y respetuosa con personalizaciones.

## Decision

### Qué es y qué no es api-starter

- **Es:** una plantilla de código TypeScript + Hono + Bun con poda física por features, perfiles curados, y tooling de generación/actualización. El código generado es propiedad del proyecto consumidor.
- **No es:** un framework privado obligatorio en runtime, un sistema de plugins dinámicos, un contenedor IoC, ni un DSL propio.

### Política de perfiles / features / recipes / dominio

- **Core del starter (A):** universal y pequeño — errores y contratos base, configuración, logging, seguridad HTTP básica, health checks, tooling de generación y actualización.
- **Feature opcional (B):** transversal, podable, con dependencias explícitas (auth, tenancy, jobs, webhooks, files, notifications). Vive en `generator/features.json` y `modules/*`/`packages/*` con `requires`/`excludedBy`.
- **Receta o integración de ejemplo (C):** wiring de proveedor, ejemplo Next/Tauri/móvil, config de despliegue. Vive en `integrations/`, `examples/` o recetas documentadas, no en runtime por defecto.
- **Dominio de producto (D):** nunca entra al starter (pedidos, inventario, citas, facturación específica). Permanece en el proyecto consumidor.

### Compatibilidad, versionado y deprecación

- Versionado SemVer para el starter (`package.json` version). `0.10.1 → 0.11.0` etc. se ejecutan secuencialmente sin saltos; rutas incompletas se rechazan.
- `multi-tenant` se conserva como alias deprecated con `replacementProfiles: [multi-tenant-core, integration-platform, platform]` y advertencia a stderr; su eliminación se reconsiderará en `0.11.0`.
- Perfiles son atajos curados; `platform` debe ser la unión completa salvo features diferidas (`dynamicRoles`).

### Propiedad del código generado

- El resultado sigue siendo código propiedad del proyecto generado. No hay dependencia runtime obligatoria hacia un paquete privado del starter. El proyecto puede divergir sin quedar obligado a instalar `@consulting/api-starter`.

### Estrategia de actualización

- Motor de materialización, comparación y migraciones versionadas (`generator/src/materialize.ts`, `hashing.ts`, `update-plan.ts`, `file-strategies.ts`).
- Flujo: leer `.api-starter/manifest.json` → validar → materializar canónica temporal → comparar `baselineHash` vs `current` vs `canonical` → clasificar (`add`/`update-safe`/`remove-safe`/`unchanged`/`customized-no-upstream`/`conflict`/`manual-migration`) → plan → backup → aplicar solo con `--apply` → validaciones posteriores (`typecheck`/`test`) → rollback si falla → bump manifest solo si todo ok → idempotente.
- `package.json` estructurado, `.env.example` key-wise, YAML vía regiones generadas o parser real; nunca regex frágil; nunca tocar `.env`.
- Migraciones de código vs datos separadas; `db:migrate` nunca se ejecuta automáticamente; `generator:update` solo añade archivos y parchea `migrations/meta/_journal.json` con detección de colisiones.

### Prohibiciones

- No feature flags de runtime para mantener código no utilizado (poda física).
- No sobrescribir silenciosamente personalizaciones; ante duda, reportar conflicto y no escribir.
- No `--force` global destructivo.
- No sistema de plugins dinámicos, IoC, service locator, clases base universales ni DSL.

### Criterios de admisión y eliminación

Toda nueva feature debe pasar la puerta de admisión (10 puntos de `docs/feature-proposal-template.md`): transversal, segundo caso real, podable, contratos explícitos, sin imports inversos, pruebas, actualización/migración, documentación, responsable, sin abstracción general prematura. Si no cumple, es receta o va directo al proyecto que la necesita.

### Presupuesto de complejidad

- El starter debe permanecer pequeño, legible y con límites `domain ← application ← http` intactos. Cada incorporación debe justificar su costo de mantenimiento; la complejidad no se añade por conveniencia de un solo proyecto.

## Consequences

- `generator/updates/registry.ts` y `generator/updates/*.ts` son la fuente de verdad para migraciones versionadas.
- `docs/feature-proposal-template.md` es obligatorio para proponer features.
- `docs/updating-generated-projects.md` documenta el flujo `doctor`/`diff`/`update`/`adopt`.
- Los checks de `apps/api/tests/boundary.test.ts` y `generator/tests/*` verifican límites y poda.
