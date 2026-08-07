# Feature Proposal Template

Use this template to propose a new feature for `api-starter`. Every proposal must be reviewed against the starter's evolution policy (ADR-0013).

## 1. Problem

- ¿Qué problema transversal resuelve?
- ¿Qué proyectos reales la necesitan? (mínimo dos casos o necesidad de plataforma demostrable)
- ¿Por qué no debe ser una receta en `integrations/`/`examples/`?

## 2. Scope Classification

- [ ] **A. Core del starter** — universal y pequeño (errores, config, logging, seguridad HTTP, health, tooling)
- [ ] **B. Feature opcional** — transversal, podable, dependencias explícitas
- [ ] **C. Receta / integración de ejemplo** — wiring de proveedor, ejemplo frontend, config de despliegue (vive en `integrations/`/`examples/`)
- [ ] **D. Dominio de producto** — nunca entra al starter (pedidos, inventario, facturación específica)

Justificación de la clasificación:

## 3. Dependencies

- ¿Qué dependencias añade (paquetes, módulos, migraciones, env vars)?
- ¿Cómo se declaran en `generator/features.json`? (`requires`, `excludedBy`)

## 4. Pruning

- ¿Cómo se poda físicamente? (módulos/paquetes/migraciones a eliminar cuando no se selecciona)
- ¿Qué archivos de composición se reescriben?

## 5. Update

- ¿Cómo se actualiza un proyecto que ya la tiene instalada?
- ¿Requiere migración de datos? ¿Es automática o manual?

## 6. Deprecation

- ¿Cómo se depreca o elimina? (replacement, timeline)

## 7. Cost

- ¿Qué costo de mantenimiento introduce? ¿Quién es el responsable?
- ¿Qué alternativas más simples fueron descartadas?

## 8. Checklist de admisión (debe cumplir todos para B)

- [ ] Transversal y reutilizable por más de un tipo de producto
- [ ] Segundo caso real demostrado
- [ ] Podable físicamente sin romper perfiles que no la usan
- [ ] Contratos y dependencias explícitas
- [ ] No introduce imports inversos hacia módulos de negocio
- [ ] Incluye pruebas unitarias, integración y del generador
- [ ] Incluye actualización/migración para proyectos que ya la tengan
- [ ] Incluye documentación, variables de entorno y operación
- [ ] Tiene responsable o criterio de retirada
- [ ] No requiere crear una abstracción general solo para acomodarla
