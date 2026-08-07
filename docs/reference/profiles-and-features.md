# Perfiles y features

**Audiencia:** usuarios y mantenedores.
**Objetivo:** catálogo vigente derivado de `generator/profiles.json` y `generator/features.json`. Esta página se mantiene sincronizada con `bun run docs:check`; no edites manualmente una lista contradictoria.

Catálogo descubrible en cualquier momento: `bun run create:project -- --list-profiles` y `--list-features` (ambas con `--json`).

## Perfiles

| Perfil | Features | Estado |
|---|---|---|
| `minimal` | — (solo base) | vigente |
| `data-api` | `persistence` | vigente |
| `authenticated` | `auth`, `authorization`, `persistence` | vigente |
| `multi-tenant-core` | `audit`, `auth`, `authorization`, `persistence`, `tenancy` | vigente |
| `integration-platform` | `apiKeys`, `audit`, `auth`, `authorization`, `jobs`, `persistence`, `tenancy`, `webhooks` | vigente |
| `platform` | `apiKeys`, `audit`, `auth`, `authorization`, `files`, `jobs`, `notifications`, `observability`, `persistence`, `tenancy`, `webhooks` | vigente |
| `multi-tenant` | `apiKeys`, `audit`, `auth`, `authorization`, `files`, `jobs`, `notifications`, `persistence`, `tenancy`, `webhooks` | **deprecated** (reemplazo: `multi-tenant-core`, `integration-platform`, `platform`) |

## Features

| Feature | Requiere | Excluye/Excluida por | Módulos y paquetes | Migraciones | Variables |
|---|---|---|---|---|---|
| `persistence` | — | — | — | 0000, 0001 | `DATABASE_URL` |
| `auth` | — | — | `auth`, `auth-client` | 0002 | `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `TRUSTED_ORIGINS` |
| `authorization` | `auth` | — | `authorization` | — | — |
| `tenancy` | `auth` | — | `organizations` | 0004 | — |
| `audit` | `persistence` | — | `audit` | 0003 | — |
| `apiKeys` | `tenancy` | — | `organizations` | 0007 | — |
| `jobs` | `persistence` | — | `jobs` | 0006 | — |
| `webhooks` | `tenancy`, `jobs` | — | `organizations` | 0005, 0008, 0009 | — |
| `files` | `tenancy` | — | `files` | 0010 | `S3_ENDPOINT`, `S3_BUCKET` (wiring del proyecto) |
| `notifications` | `jobs` | — | `notifications` | 0011 | `SMTP_URL` (wiring del proyecto) |
| `observability` | — | — | — | — | — |
| `dynamicRoles` | `tenancy` | excluida por `authorization` | — | — | — |

## Reglas

- Las dependencias son transitivas: `webhooks` → `tenancy` → `auth`.
- `dynamicRoles` está **diferida**: el generador la rechaza junto a `authorization` (que todos los perfiles vigentes incluyen).
- `platform` = unión completa de features salvo `dynamicRoles`; `generator:validate` lo comprueba.
- Los perfiles vigentes se ordenan por composición creciente; la tabla anterior refleja el catálogo real.

## Fuente única

- `generator/profiles.json` y `generator/features.json` (generados por `generator:sync` desde `generator/src/profiles.ts` y `generator/src/features.ts`).
- Explicación por caso de uso: [getting-started/choose-a-profile.md](../getting-started/choose-a-profile.md).
