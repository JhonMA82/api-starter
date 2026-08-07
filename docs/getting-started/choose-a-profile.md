# Elegir un perfil

**Audiencia:** persona que va a crear una API nueva con el starter.
**Objetivo:** elegir el perfil (o la composición de features) correcto antes de generar.

El catálogo vigente vive en `generator/profiles.json` y `generator/features.json`; esta página es su explicación humana. Hay una fuente única para las combinaciones exactas: `bun run create:project -- --list-profiles` y `--list-features`.

## Regla práctica

> Elegir el perfil más pequeño que cubra las necesidades conocidas y añadir features después.

Un proyecto generado **poda físicamente** las features no seleccionadas: menos código, menos migraciones y menos superficie que mantener. Cuesta menos empezar pequeño y añadir después que recortar.

## Tabla de decisión

| Necesidad | Perfil recomendado |
|---|---|
| API pública sin DB ni cuentas | `minimal` |
| API con persistencia sin usuarios | `data-api` |
| Aplicación single-tenant con usuarios | `authenticated` |
| SaaS con organizaciones, membresías y auditoría | `multi-tenant-core` |
| Multi-tenant con API keys, jobs y webhooks | `integration-platform` |
| Todas las capacidades disponibles | `platform` |

## Catálogo de features

Una feature es una capacidad transversal podable. El generador resuelve dependencias automáticamente (p. ej. `tenancy` exige `auth`).

| Feature | Qué incluye |
|---|---|
| `persistence` | PostgreSQL + Drizzle, migraciones, repositorios y transacciones |
| `auth` | Usuarios y sesiones con Better Auth (email/contraseña, bearer) |
| `authorization` | Permisos deny-by-default, roles y políticas (exige `auth`) |
| `tenancy` | Organizaciones, membresías e invitaciones (exige `auth`) |
| `audit` | Log de auditoría append-only (exige `persistence`) |
| `apiKeys` | API keys por organización (exige `tenancy`) |
| `jobs` | Cola de trabajos persistente y worker (exige `persistence`) |
| `webhooks` | Outbox transaccional y webhooks firmados (exige `tenancy` + `jobs`) |
| `files` | Archivos con URLs de descarga firmadas (exige `tenancy`) |
| `notifications` | Correos con plantillas y dedupe (exige `jobs`) |
| `observability` | Logging estructurado, métricas y tracing |
| `dynamicRoles` | **Diferido**: no se incluye en ningún perfil (conflicto con `authorization`) |

## Perfiles, uno a uno

### `minimal`

- **Incluye:** ninguna feature; solo la base (config, errores RFC 9457, OpenAPI, logging, health/ready/version).
- **No incluye:** persistencia, auth, ni nada de eso.
- **Caso típico:** API pública sin estado, mock, prueba de concepto.
- **Señales para no elegirlo:** necesitas guardar datos o distinguir usuarios.
- **Generación:**

  ```bash
  bun run create:project -- --profile=minimal --out=../my-api
  ```

### `data-api`

- **Incluye:** `persistence`.
- **No incluye:** usuarios (`auth`), tenancy.
- **Caso típico:** API con base de datos propia, sin cuentas de usuario (p. ej. catálogo público con persistencia).
- **Señales para no elegirlo:** necesitas autenticar llamadas o datos por cliente.
- **Generación:**

  ```bash
  bun run create:project -- --profile=data-api --out=../my-data-api
  ```

### `authenticated`

- **Incluye:** `auth`, `authorization`, `persistence`.
- **No incluye:** organizaciones multi-tenant.
- **Caso típico:** aplicación single-tenant con usuarios, roles y permisos.
- **Señales para no elegirlo:** varios clientes con datos separados entre sí.
- **Generación:**

  ```bash
  bun run create:project -- --profile=authenticated --out=../my-app
  ```

### `multi-tenant-core`

- **Incluye:** `auth`, `authorization`, `persistence`, `tenancy`, `audit`.
- **No incluye:** integraciones (API keys, jobs, webhooks), archivos, notificaciones.
- **Caso típico:** SaaS con organizaciones, membresías e invitaciones, sin integraciones.
- **Señales para no elegirlo:** necesitas API keys por organización o webhooks firmados.
- **Generación:**

  ```bash
  bun run create:project -- --profile=multi-tenant-core --out=../my-saas
  ```

### `integration-platform`

- **Incluye:** `multi-tenant-core` más `apiKeys`, `jobs`, `webhooks`.
- **No incluye:** `files`, `notifications`, `observability` (diferente de `platform`).
- **Caso típico:** plataforma que integra sistemas externos: API keys, cola de trabajos y webhooks firmados.
- **Señales para no elegirlo:** no necesitas exponer API keys ni recibir/enviar webhooks.
- **Generación:**

  ```bash
  bun run create:project -- --profile=integration-platform --out=../my-platform
  ```

### `platform`

- **Incluye:** todas las features salvo `dynamicRoles` (diferida): integraciones + `files` + `notifications` + `observability`.
- **Caso típico:** cuando quieres toda la superficie disponible del starter.
- **Señales para no elegirlo:** casi siempre; empieza por el perfil más pequeño.
- **Generación:**

  ```bash
  bun run create:project -- --profile=platform --out=../my-full-api
  ```

### `multi-tenant` (deprecated)

- **Estado:** **deprecated**. Preservado como alias por compatibilidad; genera con advertencia.
- **Reemplazo:** usa `multi-tenant-core`, `integration-platform` o `platform`, según las features que necesites.
- **Nota de compatibilidad:** se reconsiderará su eliminación en `0.12.0`; no lo uses en proyectos nuevos.

## Composición exacta: `--features` y `--with`

Si ningún perfil cuadrado sirve, compón:

- `--features=<csv>` — selección exacta de features; el generador añade las dependencias transitivas y rechaza conflictos (p. ej. `dynamicRoles` junto a `authorization`).
- `--profile=<id> --with=<csv>` — perfil curado extendido con features adicionales.

No necesitas conocer el planner interno: pide lo que quieras y el generador valida y muestra el plan final antes de crear nada.

```bash
# API single-tenant + archivos y notificaciones
bun run create:project -- --profile=multi-tenant-core --with=files,notifications --out=../my-saas

# Composición exacta sin perfil
bun run create:project -- --features=persistence,auth,authorization --out=../custom-api

# Descubrir el catálogo (también con --json para CI/agentes)
bun run create:project -- --list-profiles
bun run create:project -- --list-features
```

## Siguiente paso

[Crear un proyecto](create-a-project.md) — recorrido completo desde el clon hasta el primer commit.
