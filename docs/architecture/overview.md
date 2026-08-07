# Arquitectura

**Audiencia:** desarrolladores del starter y de proyectos generados.
**Objetivo:** visión, límites y mapa de la documentación técnica.

## Visión y límites

`api-starter` es una **fábrica de APIs**: un repositorio base más un generador que produce proyectos independientes con poda física. No es una mega-API compartida, ni un framework de runtime, ni una biblioteca que los proyectos generados importen.

- **Qué es:** un monolito modular reutilizable + CLI de generación (`create:project`, `create:module`, `add:feature`, `doctor`/`diff`/`update`/`adopt`).
- **Qué no es:** un servicio desplegable con datos compartidos; un framework con plugins cargados dinámicamente; una biblioteca con la que se construye la API en tiempo de ejecución.
- **Frontera de evolución:** la política completa vive en el ADR-0013 ([maintainers/evolution-policy.md](../maintainers/evolution-policy.md)).

## Monolito modular

Un único proceso y despliegue, dividido en módulos con límites claros que permiten extraer servicios si el proyecto crece:

```
apps/api        composición: middleware, rutas base, bootstrap, server
packages/*      plataforma compartida sin lógica de negocio
modules/*       clusters de dominio con la tríada domain / application / http
generator/      tooling de generación (fuera de los workspaces de runtime)
```

Cada `module/*` es un cluster autocontenido: dominio, aplicación, adaptadores de persistencia, rutas y tests co-localizados. Las decisiones de diseño con contexto completo viven en los [ADR](../decisions/) (inglés).

## Cómo leer la arquitectura

| Página | Responde a |
|---|---|
| [layers-and-boundaries.md](layers-and-boundaries.md) | Reglas de capas, imports y portabilidad; bootstrap y adaptadores |
| [capabilities.md](capabilities.md) | Qué incluye cada capacidad (auth, tenancy, integraciones, …) |
| [generator-and-managed-files.md](generator-and-managed-files.md) | Cómo se generan proyectos y qué archivos administra el starter |
| [overview.md](overview.md) | Visión y límites (este documento) |

## Decisiones (ADR)

| ADR | Decisión |
|---|---|
| [0001-toolchain](../decisions/0001-toolchain.md) | Toolchain: Bun, TypeScript 7.0.2 (fallback 5.9.3), Biome, pins exactos |
| [0002-openapi-hono-openapi](../decisions/0002-openapi-hono-openapi.md) | OpenAPI 3.1 generado desde schemas zod (triple fuente) |
| [0003-error-model-problem-details](../decisions/0003-error-model-problem-details.md) | Modelo de errores RFC 9457 |
| [0004-version-pinning](../decisions/0004-version-pinning.md) | Versiones exactas y lockfile commitado |
| [0005-persistence-drizzle](../decisions/0005-persistence-drizzle.md) | PostgreSQL 17 + Drizzle ORM + migraciones SQL commitadas |
| [0006-authorization-deny-by-default](../decisions/0006-authorization-deny-by-default.md) | Autorización deny-by-default y auditoría append-only |
| [0007-multi-tenancy-shared-schema](../decisions/0007-multi-tenancy-shared-schema.md) | Multi-tenancy shared schema |
| [0008-integrations-outbox-webhooks](../decisions/0008-integrations-outbox-webhooks.md) | Outbox transaccional, cola de jobs, API keys y webhooks |
| [0009-files-notifications](../decisions/0009-files-notifications.md) | Archivos como referencias y notificaciones con plantillas |
| [0010-generator-profiles-features](../decisions/0010-generator-profiles-features.md) | Generador declarativo con poda física |
| [0011-frontend-integration-kits](../decisions/0011-frontend-integration-kits.md) | SDK agnóstico y kits de integración frontend |
| [0012-hardening-observability](../decisions/0012-hardening-observability.md) | Hardening: observabilidad, load test, Docker y backup/restore |
| [0013-starter-evolution-and-update-policy](../decisions/0013-starter-evolution-and-update-policy.md) | Evolución del starter, perfiles granulares, manifiesto y política de actualización |
