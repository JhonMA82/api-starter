# Documentación

Mapa de la documentación orientado por intención. Cada entrada enlaza a una guía, no a una lista de archivos.

## ¿Qué necesitas hacer?

### Crear una API nueva

- [Elegir un perfil](getting-started/choose-a-profile.md) — qué perfil (o composición de features) cubre tu caso.
- [Crear un proyecto](getting-started/create-a-project.md) — generar, instalar, configurar y arrancar una API desde cero.
- [Primer módulo](getting-started/first-module.md) — cómo añadir dominio con `create:module`.

### Evolucionar un proyecto generado

- [Agregar una feature](guides/add-a-feature.md) — añadir capacidad a un proyecto existente.
- [Actualizar un proyecto generado](guides/update-a-generated-project.md) — `doctor` → `diff` → `update --apply`.
- [Adoptar un proyecto legacy](guides/adopt-a-legacy-project.md) — incorporar un proyecto sin manifiesto.

### Entender el starter

- [Arquitectura](architecture/overview.md) — visión, capas y límites.
- [Capas y dirección de dependencias](architecture/layers-and-boundaries.md) — reglas de imports y portabilidad.
- [Capabilities](architecture/capabilities.md) — autenticación, autorización, tenancy, integraciones, archivos, notificaciones, SDK.
- [Generador y archivos administrados](architecture/generator-and-managed-files.md) — poda física, manifiesto y actualización.
- [Decisiones (ADR)](decisions/) — decisiones de arquitectura con contexto completo (inglés).

### Operar una API

- [Migraciones](operations/migrations.md) — crear, aplicar y revisar migraciones de base de datos.
- [Backup y restauración](operations/backup-and-restore.md) — volcado, restauración y drill de verificación.
- [Prueba de carga](operations/load-testing.md) — harnés reproducible y cómo leer los resultados.
- [Modelo de amenazas](security/threat-model.md) — amenazas, controles obligatorios y prioridades.

### Mantener el starter

- [Guía de desarrollo](maintainers/development.md) — instalación, estructura interna, cómo añadir features.
- [Pruebas y CI](maintainers/testing-and-ci.md) — suites, cobertura y reproducción local de CI.
- [Releases y versionado](maintainers/releases-and-versioning.md) — fuente de versión, changelog, checklist.
- [Política de evolución](maintainers/evolution-policy.md) — qué entra y qué no entra al starter (ADR-0013).
- [Plantilla de propuesta de feature](maintainers/feature-proposal-template.md) — puerta de admisión para features nuevas.
- [Referencia CLI](reference/cli.md) — todos los comandos del generador.
- [Variables de entorno](reference/environment.md) — variables agrupadas por feature o perfil.
- [Perfiles y features](reference/profiles-and-features.md) — catálogo derivado de `generator/profiles.json` y `generator/features.json`.
- [Endpoints](reference/endpoints.md) — rutas del repositorio completo (un proyecto generado puede tener menos).
- [Estructura del repositorio](reference/repository-structure.md) — starter vs. proyecto generado vs. tooling interno.

## Documentos normativos

- [ADR (docs/decisions/)](decisions/) — decisiones vigentes; no editar sin un ADR nuevo.
- [AGENTS.md](../AGENTS.md) — convenciones del repositorio para agentes y colaboradores.

## Histórico y trazabilidad

- [docs/archive/](archive/) — especificación original, reportes de validación cerrados y mediciones puntuales. No son fuente vigente.
- [docs/openspec/](openspec/) y [docs/superpowers/](superpowers/) — carpetas internas de herramientas de desarrollo; no forman parte del onboarding.
