# Variables de entorno

**Audiencia:** usuarios del starter y desarrolladores de proyectos generados.
**Objetivo:** referencia de variables agrupadas por feature o perfil.

La validación vive en `packages/config` (`env.ts`): fail-fast antes de arrancar. En un proyecto generado, `env.ts` se adapta a las features seleccionadas: las variables de features podadas **desaparecen del esquema y de `.env.example`**.

## Base (siempre presentes)

| Variable | Obligatoria | Por defecto | Qué hace |
|---|---|---|---|
| `APP_ENV` | no | `development` | `development` \| `test` \| `production` |
| `APP_VERSION` | no | versión de `package.json` | Versión reportada en `/version` |
| `API_BASE_URL` | no | `http://localhost:3000` | URL base pública de la API |
| `LOG_LEVEL` | no | `info` | `debug` \| `info` \| `warn` \| `error` |
| `PORT` | no | `3000` | Puerto HTTP (1–65535) |
| `HOST` | no | `0.0.0.0` | Interfaz de escucha |
| `CORS_ORIGINS` | no | vacío (denegar todo) | Orígenes permitidos, separados por comas |

## Feature `persistence`

| Variable | Obligatoria | Por defecto | Qué hace |
|---|---|---|---|
| `DATABASE_URL` | **sí** | — | URL de conexión PostgreSQL. El servidor arranca sin base, pero las rutas con persistencia y los tests de DB la necesitan |

## Feature `auth`

| Variable | Obligatoria | Por defecto | Qué hace |
|---|---|---|---|
| `BETTER_AUTH_SECRET` | **sí** | — | Secreto de firma de sesiones (mínimo 32 caracteres) |
| `BETTER_AUTH_URL` | no | `API_BASE_URL` | URL base pública de autenticación |
| `TRUSTED_ORIGINS` | no | solo el origen de `API_BASE_URL` | Orígenes adicionales de confianza, separados por comas |

## Feature `files` (wiring del proyecto)

| Variable | Obligatoria | Por defecto | Qué hace |
|---|---|---|---|
| `S3_ENDPOINT` / `S3_BUCKET` | depende del wiring | — | Declaradas en `generator/features.json`; **no** forman parte del esquema base. El adaptador S3/R2/MinIO es un drop-in posterior cuyo wiring queda a cargo del proyecto generado |

## Feature `notifications` (wiring del proyecto)

| Variable | Obligatoria | Por defecto | Qué hace |
|---|---|---|---|
| `SMTP_URL` | depende del wiring | — | Declarada en `generator/features.json`; no forma parte del esquema base. El `Mailer` de producción se inyecta desde el proyecto |

## Cómo saber qué necesita tu proyecto

```bash
cp .env.example .env
bun run dev        # si falta algo obligatorio, el proceso falla listando los problemas
```

El `.env.example` de un proyecto generado solo contiene las variables de sus features.

## Fuente única

- Schemas: `packages/config/src/env.ts`.
- Plantilla: `.env.example`.
- Declaración por feature: `generator/features.json` (`envVars`).
