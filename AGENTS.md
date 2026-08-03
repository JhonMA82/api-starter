# AGENTS.md

Convenciones del repositorio para agentes de IA y colaboradores humanos.

## Idiomas

- Prosa de la documentación (README, docs/architecture.md, este archivo): **español**.
- Código, comentarios en el código, comandos, identificadores, mensajes de commit y ADR (`docs/decisions/`): **inglés**.

## Pins exactos y reproducción

- Versiones **exactas** en todos los `package.json` (sin `^`, `~` ni `latest`).
- `bun.lock` se commitea y **no se edita a mano**; usar `bun install` para regenerar.
- `packageManager: bun@1.3.14` (raíz) y `.bun-version` = `1.3.14`; CI lee `.bun-version` (`bun-version-file`).
- El catálogo `catalog/dependencies.json` registra versión, licencia, propósito y fuente de cada dependencia; mantenerlo al tocar dependencias.
- Trampa conocida (R4): `@hono/standard-validator` debe quedarse en `0.2.3` exacto (peer de hono-openapi es `^0.2.0`; no aceptar sugerencias de 0.3.x).

## Capas y estructura

- Dirección de dependencias: `domain ← application ← http` (ver `docs/architecture.md`).
- `packages/*` (config, core, contracts): **sin** importaciones de Hono ni Bun. Excepción explícita: `packages/auth` puede importar Hono (solo tipos) y better-auth; `packages/auth-client`, solo better-auth.
- `modules/*`: **sin** importaciones de `@consulting/auth` ni `@consulting/auth-client`.
- `modules/*/src/domain` y `modules/*/src/application`: **sin** Hono ni Bun.
- `apps/api/src/server.ts` es el **único** archivo de producción que toca APIs de Bun.
- Rutas de negocio se montan bajo `/api/v1`.
- Errores: RFC 9457 (`application/problem+json`), siempre con `code`, `requestId`, `instance`; nunca filtrar stack traces ni internos.

## Comandos

| Comando | Qué hace |
|---|---|
| `bun run dev` | servidor en watch (apps/api/src/server.ts) |
| `bun run lint` | `biome ci .` |
| `bun run typecheck` | `bun x tsc --noEmit` (TS 7.0.2; fallback 5.9.3 según ADR-0001) |
| `bun test` | suite completa |
| `bun test --coverage` | con umbral global 0.8 (`bunfig.toml`) |
| `bun x tsc --noEmit` | verificación de tipos directa |
| `bun test apps/api/tests/openapi.test.ts` | contrato OpenAPI (toda ruta documentada) |
| `bun run db:up` / `db:down` | levantar/detener postgres 17 local (podman, contenedor `api-pg`) |
| `bun run db:migrate` | aplicar migraciones pendientes (idempotente) |
| `bun run db:generate` | regenerar migraciones desde los schemas (gate de drift en CI) |
| `bun run db:seed` | datos semilla (idempotente) |
| `DATABASE_URL=... bun test --parallel=1` | tests de DB reales, serializados (CP-C) |

## Qué no editar

- `bun.lock` (solo regenerar vía `bun install`).
- Migraciones ya aplicadas: append-only (nunca editarlas; correcciones = nueva migración — ver docs/migrations-runbook.md).
- `catalog/dependencies.json` fuera del flujo de pin/registro (actualizarlo con propósito y licencia verificada).
- ADR ya aceptados: modificarlos solo con un ADR nuevo o en el flujo de revisión explícito.

## Convención de commits

Un work unit = un commit Conventional Commit; tests junto al comportamiento que verifican; docs junto al cambio que explican.
