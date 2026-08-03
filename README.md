# @consulting/api-starter

Plantilla reutilizable de API HTTP en **Bun 1.3.14 + Hono**, organizada como monolito modular con workspaces. Incluye validación de configuración fail-fast, modelo de errores RFC 9457, contratos OpenAPI 3.1 generados desde schemas zod, logger estructurado JSON, imagen Docker multi-stage no-root, CI de 5 jobs y tests con umbral de cobertura.

## Quickstart

### Prerequisitos

- [Bun](https://bun.sh) `1.3.14` (el archivo `.bun-version` fija la versión; `oven-sh/setup-bun` la respeta en CI).
- Docker (opcional, para el perfil `core` de Docker Compose).

### Instalación

```bash
bun install
```

### Entorno

Copia `.env.example` a `.env` y ajusta los valores si es necesario. `LOG_LEVEL` es obligatorio; el resto de variables tienen valores por defecto:

```bash
cp .env.example .env
```

Variables disponibles (`.env.example`):

| Variable | Obligatoria | Por defecto | Descripción |
|---|---|---|---|
| `APP_ENV` | no | `development` | `development` \| `test` \| `production` |
| `APP_VERSION` | no | `0.1.0` | Versión reportada en `/version` |
| `API_BASE_URL` | no | `http://localhost:3000` | URL base pública de la API |
| `LOG_LEVEL` | **sí** | — | `debug` \| `info` \| `warn` \| `error` |
| `PORT` | no | `3000` | Puerto HTTP (1–65535) |
| `HOST` | no | `0.0.0.0` | Interfaz de escucha |
| `CORS_ORIGINS` | no | `""` (denegar todo) | Lista separada por comas de orígenes permitidos |

### Desarrollo

```bash
bun run dev
```

Arranca `apps/api/src/server.ts` en modo watch. El servidor responde en `http://localhost:3000` y termina limpiamente con SIGTERM/SIGINT (drena las peticiones en vuelo).

### Endpoints

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/health` | Sonda de vida (liveness) |
| GET | `/ready` | Sonda de disponibilidad (readiness) |
| GET | `/version` | Nombre, versión y entorno del servicio |
| GET | `/openapi.json` | Documento OpenAPI 3.1.0 generado desde los contratos |
| GET | `/docs` | Interfaz de documentación interactiva (Scalar) |
| GET | `/api/v1/example/hello?name=...` | Módulo de ejemplo (demuestra la estructura por capas) |

Los errores se devuelven como `application/problem+json` (RFC 9457) con `code`, `requestId` e `instance`.

### Tests

```bash
bun test              # suite completa
bun test --coverage   # con umbral global 0.8 (bunfig.toml)
bun run lint          # biome ci .
bun run typecheck     # bun x tsc --noEmit
```

### Docker

```bash
docker build -t consulting-api:0.1.0 .
docker run --rm -e LOG_LEVEL=info -p 3000:3000 consulting-api:0.1.0
```

La imagen es multi-stage sobre `oven/bun:1.3.14-slim`, ejecuta como usuario no-root `bun` y expone un healthcheck contra `/health`.

Docker Compose (perfil `core`, solo la API; sin base de datos ni redis):

```bash
docker compose --profile core up
```

### CI

Cada pull request pasa por `.github/workflows/ci.yml`: 5 jobs (`lint`, `typecheck`, `test`, `openapi-validation`, `docker-build`) con acciones fijadas por tag completo y `bun install --frozen-lockfile`.

### Estructura del repositorio

```
api/
├─ .bun-version            versión de Bun fijada (1.3.14)
├─ .env.example            plantilla de entorno (sin secretos)
├─ Dockerfile              imagen multi-stage no-root
├─ docker-compose.yml      perfil "core": solo api
├─ bunfig.toml             umbral de cobertura 0.8
├─ catalog/dependencies.json   registro de dependencias (versión, licencia, propósito)
├─ docs/architecture.md    visión, capas, matriz de portabilidad (español)
├─ docs/decisions/         ADR 0001–0004 (inglés)
├─ apps/api/               aplicación HTTP (middleware, rutas base, bootstrap, server)
├─ packages/config/        validación fail-fast de entorno (zod)
├─ packages/core/          modelo de errores RFC 9457 + contrato de logger
├─ packages/contracts/     schemas zod base (triple fuente: tipos, OpenAPI, tests)
└─ modules/example/        módulo de ejemplo por capas (domain/application/http)
```

## Convenciones

- Versiones exactas en todos los manifests (sin `^`/`~`/`latest`); `bun.lock` se commitea y no se edita a mano.
- Prosa de la documentación en español; código, comandos e identificadores en inglés. Los ADR quedan en inglés.
- Dirección de dependencias: `domain ← application ← http`; solo `apps/api/src/server.ts` toca APIs de Bun.
