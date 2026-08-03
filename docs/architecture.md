# Arquitectura

## Visión: monolito modular

La API es un **monolito modular**: un único proceso y despliegue, pero el código está dividido en módulos con límites claros que permiten extraer servicios si el proyecto crece. Cada módulo sigue una tríada interna de capas — `domain`, `application`, `http` — y los paquetes compartidos (`packages/*`) contienen lógica de plataforma sin lógica de negocio.

El objetivo de Fase 0+1 es la fundación: un núcleo HTTP mínimo, reproducibilidad total (pins exactos, lockfile congelado, imagen Docker no-root) y un solo módulo de ejemplo que demuestre el patrón de capas.

## Dirección de dependencias

```
domain ← application ← http
```

- `domain`: lógica pura, sin importaciones de Hono ni Bun, sin E/S. (ej. `modules/example/src/domain/greeting.ts`).
- `application`: orquesta la capa `domain`; puede depender de contratos y de `packages/core`; sin Hono ni Bun.
- `http`: rutas de Hono, validación con zod y respuesta `application/problem+json`; es la única capa que conoce el framework.
- `packages/*`: plataforma compartida — `config` (entorno), `core` (modelo de errores RFC 9457 + contrato de logger), `contracts` (schemas zod base). Los paquetes no importan Hono ni Bun.
- `apps/api`: composición — middleware pipeline, rutas base, `openapi.json` y `/docs`, bootstrap y el entrypoint `server.ts`.

**Único archivo que toca APIs de Bun:** `apps/api/src/server.ts` (`Bun.serve`, shutdown con drenado). Es la frontera de portabilidad del proyecto.

## Matriz de portabilidad

| Superficie | Dependencia | Estado | Ruta de migración a Node |
|---|---|---|---|
| Servidor HTTP | `Bun.serve` (en `apps/api/src/server.ts`) | En uso | `@hono/node-server` — **NO instalado**, solo documentado |
| Runner de tests | `bun:test` | En uso | Node 20+ `node:test` o vitest |
| Gestión de paquetes | bun (workspaces, `bun install --frozen-lockfile`) | En uso | pnpm/npm workspaces |
| Typecheck | TypeScript 7.0.2 (`tsc` de tsgo) | En uso | versiones LTS de TypeScript (fallback documentado: 5.9.3, ADR-0001) |
| Formato/lint | Biome 2.5.6 | En uso | multiplataforma (no es específico de Bun) |
| `process.env` en vez de `Bun.env` | — | En uso | sin cambios |
| Docker | `oven/bun:1.3.14-slim` | En uso | imagen Node `22-slim` + `npm ci` |

La ruta Node vía `@hono/node-server` está **documentada, no instalada**: el único archivo a tocar sería `apps/api/src/server.ts`, porque el resto del código no depende de Bun. Ver ADR-0001 para la política de toolchain y su revisión en Fase 2.

## Perfiles y fases futuras (resumen)

- **Fase 0+1 (actual):** fundación — registros, ADRs, núcleo HTTP con rutas base, OpenAPI 3.1 + Scalar, módulo de ejemplo, Docker y CI de 5 jobs.
- **Fase 2 y posteriores:** sin comprometer detalles concretos — se prevé crecimiento hacia autenticación, persistencia y más módulos de negocio bajo `/api/v1`, junto con la revisión de decisiones que lo requieran (p.ej. toolchain de datos, manejo de secretos, gate de capas automatizado).
- **Perfil Docker `core`:** solo el servicio `api`. Cualquier servicio adicional (base de datos, caché, workers) se declarará en perfiles futuros; esta fundación no los asume.

## Modelo de datos y errores

- Errores: RFC 9457 (`application/problem+json`) con `code` estable, `requestId` e `instance`; un único normalizador (`onError`/`notFound`) mapea status → código. Ver ADR-0003.
- Contratos: schemas zod en `packages/contracts` (base) y co-localizados en cada módulo; alimentan tipos, documento OpenAPI 3.1 y tests (triple fuente). Ver ADR-0002.
