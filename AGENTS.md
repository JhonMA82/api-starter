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
- `packages/authorization` es 100% puro (sin dependencias de runtime); `packages/audit` puede importar drizzle-orm y postgres pero no Hono ni Bun ni better-auth.
- `modules/*`: **sin** importaciones de `@consulting/auth` ni `@consulting/auth-client`; tampoco importan `@consulting/authorization` para decidir permisos en repositorios (la decisión vive en http vía `requirePermission`). `modules/organizations` (cluster de tenant: organizaciones/membresías/invitaciones) sí puede importar `@consulting/audit` para la auditoría por tenant.
- `modules/*/src/domain` y `modules/*/src/application`: **sin** Hono ni Bun.
- Recursos de tenant: las búsquedas tenant-scoped siempre llevan `organizationId` (nunca ids desnudos para membresías/invitaciones); las invitaciones se resuelven por hash del token.
- Integraciones (Fase 6): `modules/*` pueden usar `node:crypto` para hashing (API keys) y firmas HMAC (webhooks); el secreto de los endpoints de webhooks salientes se guarda en texto plano por diseño (`webhook_endpoints.secret`, nunca se devuelve en respuestas); el cluster de integraciones vive en `modules/organizations` (outbox, API keys, webhooks) + `modules/jobs` (JobQueue, worker del outbox).
- Archivos y notificaciones (Fase 7): `modules/files` y `modules/notifications`; los archivos son referencias, nunca blobs (la tabla `files` solo guarda metadatos); los tokens de descarga son firmas HMAC y el token ES la autorización (ruta de descarga pública); los cuerpos de correo nunca se loguean (solo to/template/dedupe/subject); `modules/notifications` depende de `modules/jobs` (JobQueue) para el envío asíncrono.
- `generator/` es tooling fuera de los workspaces: los proyectos generados excluyen físicamente las features no seleccionadas; nunca se sobrescriben archivos no generados sin `--force`; los cambios de migración o datos nunca son automáticos; las plantillas y manifiestos versionados deben mantenerse sincronizados y formateados.
- `packages/sdk` y sus kits (Fase 9): **sin** dependencias de runtime; no importan React, Next, TanStack, Tauri, Node ni Bun. Los consumidores inyectan `fetch`, almacenes seguros y bridges nativos; las decisiones de seguridad viven en la API, nunca solo en loaders del frontend.
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
| `bun run db:backup` | volcado pg_dump custom a `backups/` (runbook: docs/backup-restore.md) |
| `bun run db:restore` | restaurar un volcado (`--file` + `--force` obligatorio; destructivo) |
| `bun run worker` | worker standalone del outbox (perfil compose `worker`) |
| `DATABASE_URL=... bun test --parallel=1` | tests de DB reales, serializados (CP-C) |

## Qué no editar

- `bun.lock` (solo regenerar vía `bun install`).
- Migraciones ya aplicadas: append-only (nunca editarlas; correcciones = nueva migración — ver docs/migrations-runbook.md).
- `catalog/dependencies.json` fuera del flujo de pin/registro (actualizarlo con propósito y licencia verificada).
- ADR ya aceptados: modificarlos solo con un ADR nuevo o en el flujo de revisión explícito.

## Convención de commits

Un work unit = un commit Conventional Commit; tests junto al comportamiento que verifican; docs junto al cambio que explican.
