# API Starter

Fábrica de APIs HTTP en **Bun + Hono**: un repositorio base y un generador con el que crear APIs independientes (pequeña y pública, single-tenant, SaaS multi-tenant, plataforma de integraciones) con poda física de las capacidades que no uses.

Este repositorio **no es una mega-API compartida**: cada proyecto generado es un repositorio propio, autocontenido y sin dependencia en runtime de este starter.

## ¿Qué necesitas hacer?

### Crear una API nueva

```bash
git clone https://github.com/JhonMA82/api-starter.git
cd api-starter
bun install --frozen-lockfile
bun run create:project -- --profile=minimal --out=../my-api
cd ../my-api
bun install
cp .env.example .env
bun run dev
```

Comprueba que responde: `curl http://localhost:3000/health` → `{"status":"ok"}`.

Elige otro perfil o una composición por features en la guía [Elegir un perfil](docs/getting-started/choose-a-profile.md). El recorrido completo está en [Crear un proyecto](docs/getting-started/create-a-project.md).

### Mantener el starter

Guías para quien modifica este repositorio (base, generador, perfiles, CI o política de actualización): [Documentación para mantenedores](docs/README.md#mantener-el-starter).

## Elegir perfil

| Necesidad | Perfil recomendado |
|---|---|
| API pública sin DB ni cuentas | `minimal` |
| API con persistencia sin usuarios | `data-api` |
| Aplicación single-tenant con usuarios | `authenticated` |
| SaaS con organizaciones, membresías y auditoría | `multi-tenant-core` |
| Multi-tenant con API keys, jobs y webhooks | `integration-platform` |
| Todas las capacidades disponibles | `platform` |

`multi-tenant` está **deprecated** (usa `multi-tenant-core`, `integration-platform` o `platform`). Explicación por caso de uso y límites: [choose-a-profile.md](docs/getting-started/choose-a-profile.md).

## Qué incluye (resumen)

Configuración fail-fast, errores RFC 9457, OpenAPI 3.1 + Scalar, logging estructurado, autenticación Better Auth, autorización deny-by-default con auditoría append-only, multi-tenancy, outbox/jobs/API keys/webhooks, archivos con URLs firmadas, notificaciones, SDK TypeScript y operación (métricas, Docker no-root, backup/restore). Detalle: [Capabilities](docs/architecture/capabilities.md).

## Estado y requisitos

- Versión: `0.11.0` (fuente: `package.json`).
- Bun `1.3.14` (`.bun-version`; CI lo respeta). Podman o Docker solo para la base de datos local.
- Pins exactos de dependencias y `bun.lock` commiteado; catálogo en `catalog/dependencies.json`.

## Arranque de este repositorio (mantenedores)

```bash
bun install           # instala los workspaces (bun.lock fijado)
cp .env.example .env  # plantilla de entorno; ajusta si hace falta
bun run dev           # servidor en watch en http://localhost:3000
```

Los tres valores obligatorios del repositorio completo son `LOG_LEVEL`, `DATABASE_URL` y `BETTER_AUTH_SECRET`; en un proyecto generado, las obligatorias dependen del perfil (ver [reference/environment.md](docs/reference/environment.md)). Base de datos local: `bun run db:up && bun run db:migrate` (ver [operations/migrations.md](docs/operations/migrations.md)).

## Documentación

- [docs/README.md](docs/README.md) — índice por tarea: onboarding, guías, arquitectura, referencia, operación y mantenimiento.
- [Histórico y trazabilidad](docs/archive/) — especificación original y reportes de validación cerrados (no normativos).

## Licencia

MIT — ver [LICENSE](LICENSE).
