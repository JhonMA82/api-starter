# Validación final

> **HISTÓRICO** — Reporte de validación cerrado de la versión 0.10.0. No describe el estado actual del starter: ver [`docs/README.md`](../../README.md) y [`docs/maintainers/testing-and-ci.md`](../../maintainers/testing-and-ci.md).

Fecha: 2026-08-03 (Fase 10, WU5 — documentación final).

Alcance: validación del **starter completo** (`consulting-hono-api-starter`,
Fases 0-10 del roadmap): fundación, persistencia, autenticación,
autorización, multi-tenancy, integraciones, archivos y notificaciones,
generador, kits de integración frontend y hardening.

Runbook de esta validación: se ejecutaron los comandos de verificación de la
tabla siguiente, se generaron los cinco perfiles del catálogo, se corrieron
las suites de tests (sin DB y con DB real), se construyó y fumó la imagen
Docker, se ejecutó el load test reproducible y se realizó un drill real de
backup→validate→restore contra una base de datos scratch. Las limitaciones y
los riesgos pendientes que no se cierran en este starter quedan listados
explícitamente más abajo; ningún criterio se da por verificado sin evidencia
en este reporte.

## Comandos ejecutados

| Comando | Resultado |
|---|---|
| `bun x tsc --noEmit` | exit 0 — sin errores de tipos |
| `bun run lint` (`biome ci .`) | exit 0 — solo el aviso preexistente de deprecación de `biome.json` |
| `bun test --no-env-file` | 856 tests / 0 fail (69 archivos) — suite completa sin DB |
| `DATABASE_URL=... bun test --parallel=1` | ~742-746 tests / 0 fail — suites de DB reales serializadas |
| `bun test --coverage` | exit 0 — umbral 0.8 por archivo (con ignores CP-B para infra ejercitada por DB) |
| `bun run db:up` / `db:migrate` / `db:seed` | postgres 17 local arriba; migraciones aplicadas (idempotente); seed 0 filas nuevas |
| `bun run db:backup` / `db:restore` | volcado pg_dump custom real + restauración verificada contra una DB scratch (drill §20.2) |
| `bun scripts/load-test.ts --duration=10 --concurrency=20` | resultados en `docs/load-test-results.md` — 0 errores en todos los runs |
| `podman build -t consulting-api:0.10.0 .` | imagen construida; smoke tests OK (health 200, usuario no-root, shutdown graceful del worker) |
| `bun run generator:validate` / `generator:sync` | catálogo válido, manifiestos sincronizados |
| `bun run create:project` (minimal y multi-tenant) | proyectos generados con poda física, journal reescrito y templates seleccionadas |
| `bun run create:module` / `add:feature` | scaffolds y evolución de features verificados e2e |

## Resultados

- **Tests sin DB:** 856 / 0 fail (69 archivos) — toda la suite hermética
  (unidades, rutas, middleware, contratos OpenAPI, SDK, generador, scripts).
- **Tests con DB real:** ~742-746 / 0 fail corriendo con `DATABASE_URL` y
  `--parallel=1` (los archivos de DB resetean esquemas y deben correr
  serializados). Cubren auth, autorización, auditoría, tenancy,
  integraciones, archivos, notificaciones y migraciones.
- **Cobertura:** gate exit 0 con umbral 0.8 por archivo; los ignores CP-B se
  aplican solo a infraestructura ejercitada por las suites de DB reales.
- **Typecheck:** `bun x tsc --noEmit` limpio (TS 7.0.2).
- **Lint:** Biome exit 0; única salida el aviso de deprecación de `biome.json`
  preexistente al repositorio.
- **Generador (e2e):** `create:project` para `minimal` y `multi-tenant`,
  `create:module` y `add:feature` verificados.
- **SDK y kits (Fase 9):** 84 tests del SDK; kits TanStack/Next/móvil/Tauri
  compilados y consumibles desde `integrations/`.
- **Load test:** 0 errores en todos los runs; `/health` en estado estacionario
  ~250.6 req/s (p95 174.8 ms), primer run 211.6 req/s (p95 223.2 ms),
  `hello` 191.1 req/s (p95 235.4 ms) y `/metrics` 231.2 req/s (p95 175.2 ms)
  con 20 workers concurrentes en localhost. El p95 no alcanza el objetivo
  blando informativo de < 100 ms; es un dato de referencia, no un gate.
- **Docker:** `podman build consulting-api:0.10.0` exitoso; smoke tests
  (health 200, usuario no-root, shutdown graceful del worker).
- **Backup/restore:** drill real §20.2 — volcado custom, restauración contra
  DB scratch y comparación de datos, todo verificado.

## Perfiles generados

El catálogo genera los cinco perfiles: `minimal`, `data-api`, `authenticated`,
`multi-tenant` y `platform`. `create:project` aplica poda **física**:
módulos, paquetes, migraciones, snapshots y tests de aplicación no
seleccionados se eliminan del proyecto generado, el journal de migraciones se
renumera y las variantes de plantilla (app/rutas) se seleccionan por
composición. `add:feature` (incluido el alias `multitenancy`) y
`create:module` (scopes global/user/tenant) fueron verificados e2e.

## Pruebas

| Área | Cobertura |
|---|---|
| Unit / hermético | Suite sin DB completa (856 tests, 69 archivos) |
| Real-DB por módulo | authorization, tenancy (organizaciones), audit, webhooks (in/out), apiKeys, files, notifications, jobs, outbox |
| Migraciones | Journal desde cero, upgrade y aplicación idempotente; sin `push` en producción |
| Aislamiento / IDOR | Suites de aislamiento cross-tenant y de IDOR |
| Invariantes de ciclo de vida | Último owner, expiración/uso único de invitaciones, cascadas |
| SDK y kits | 84 tests del SDK (core + TanStack/Next + móvil/Tauri) |
| Generador | 62+ tests (catálogo, validación, poda, cirugía del journal, e2e) |
| Scripts | 38 tests (config, db scripts, backup/restore) |

## Cobertura crítica

- Gate de cobertura exit 0 con umbral **0.8 por archivo**; los ignores CP-B
  cubren exclusivamente infraestructura ejercitada por suites de DB reales
  (la cobertura no-DB no puede medir paths que requieren PostgreSQL).
- Áreas ejercitadas con DB real: authorization, tenancy, audit, webhooks,
  API keys, files, notifications, jobs y outbox.
- Nota (spec §21.5): la cobertura es un **control de regresión, no un
  sustituto** de las pruebas de aislamiento, IDOR, invariantes y del modelo de
  amenazas; el gate valida que cada archivo no baje del umbral, no la
  corrección del comportamiento.

## Docker

- Imagen multi-stage sobre `oven/bun:1.3.14-slim` con el workspace completo
  (`--frozen-lockfile`, todos los manifests de apps/packages/modules),
  usuario no-root `bun`, labels OCI versionables (`IMAGE_VERSION` default
  0.10.0, `IMAGE_SOURCE`), `STOPSIGNAL SIGTERM` y `APP_VERSION` desde el
  build.
- Healthcheck contra `/health`: **nota** — podman avisa que OCI ignora
  `HEALTHCHECK`; Docker sí lo soporta. Es una limitación de la plataforma de
  contenedores, no de la imagen.
- Perfil compose `worker` para el outbox worker (`scripts/worker.ts`, poll con
  fan-out de webhooks y shutdown graceful). Los perfiles redis/storage/
  observability están **documentados como ausentes a propósito** (spec §23.2:
  sin servicios que no tengan implementación); los puntos de extensión viven
  en ADR-0008/ADR-0009.

## Limitaciones

- Rate limiting diferido (no hay middleware de rate limiting).
- CSRF mitigado parcialmente: cookies `SameSite=Lax` + origin checks; sin
  token de doble envío.
- Job de escaneo de vulnerabilidades en CI y SBOM diferidos.
- Roles dinámicos de organización diferidos (ADR-0007, catálogo).
- Borrado físico de archivos y job de retención diferidos (solo soft-delete).
- Sweeper de reintentos de entregas de webhooks diferido (el worker reintenta
  mientras polla, sin barrido dedicado de entregas atascadas).
- Secretos de proveedor de webhooks entrantes en un `Map` estático;
  almacén de secretos respaldado por DB diferido.
- Adaptador Redis/BullMQ de la JobQueue diferido (solo PostgreSQL; in-memory
  para tests).
- Locale/preferencias por usuario para notificaciones diferido (fallback es
  por defecto).
- Kits n8n y Python fuera del alcance por decisión del usuario (Fase 9).
- Revocación de sesiones ante cambios críticos diferida.
- RLS (Row-Level Security) opcional/diferido (la tenancy usa shared schema
  con acotación por repositorio).
- Automatización de backups (cron) no incluida: solo runbook y scripts.
- `signedUrlSecret`/secretos de webhook sin validación de longitud mínima en
  el wiring (diferido menor).

## Riesgos pendientes

Prioridades del modelo de amenazas (`docs/threat-model.md`):

1. Rate limiting (rutas públicas y `accept-invitation`).
2. CSRF hardening con token de doble envío si el frontend se sirve cross-site.
3. Job de escaneo de vulnerabilidades en CI (`bun audit` + escáner de imagen)
   y SBOM.
4. Cron de backups + drills de restauración periódicos.
5. Validación de magic bytes en subidas de archivos.
6. Sweeper de reintentos de entregas (vía JobQueue).
7. Roles dinámicos de organización.
8. Adaptador OTel (el contrato `Tracer` ya existe, sin proveedor).
9. Revocación de sesiones ante cambios críticos.
10. RLS opcional como refuerzo de la tenancy.

## Decisiones no implementadas

Diferidas de forma explícita en ADRs y el modelo de amenazas (implementadas
solo como contratos o documentadas como puntos de extensión):

- Adaptador Redis/BullMQ de la JobQueue (ADR-0008).
- Almacén de secretos de proveedor de webhooks respaldado por DB (ADR-0008).
- Borrado físico de archivos y job de retención (ADR-0009).
- Locale/preferencias por usuario en notificaciones (ADR-0009).
- Roles dinámicos de organización (ADR-0007, ADR-0010).
- RLS (ADR-0007, opcional).
- Kits n8n y Python (decisión del usuario, ADR-0011).
- Job de vulnerabilidades/SBOM, rate limiting, token CSRF, cron de backups,
  magic bytes y sweeper (modelo de amenazas, §20.2).

## Recomendaciones para 0.2.0

Priorizadas (esfuerzo aproximado):

1. **Rate limiting** — middleware por IP/API key sobre rutas públicas y
   `accept-invitation`.
2. **CSRF** — token de doble envío si el frontend se sirve cross-site.
3. **Escaneo de vulnerabilidades en CI + SBOM** — `bun audit` + grype/trivy +
   syft.
4. **Backup cron + drills** — automatizar el runbook y programar drills de
   restauración.
5. **Magic bytes en archivos** — validación de contenido real, no solo MIME
   declarado.
6. **Sweeper de entregas** — reintentos de webhooks atascados vía JobQueue.
7. **Roles dinámicos de organización** — superar los roles predefinidos.
8. **Adaptador OTel** — proveedor real tras el contrato `Tracer`/`Span`.
9. **Revocación de sesiones** ante cambios críticos de seguridad.
10. **Kits n8n y Python** — si se decide retomarlos.
11. **Adaptador Redis** para la JobQueue si el volumen lo requiere.
12. **Cadencia de revisión de seguridad** — revisión periódica guiada por el
    modelo de amenazas.

## Criterios de aceptación (§29)

Checklist del spec §29 con el estado en este starter. Marcado = verificado;
los ítems no marcados quedan explícitamente diferidos.

### Base

- [x] Un proyecto `minimal` se genera y ejecuta.
- [x] No instala DB ni auth (poda física).
- [x] OpenAPI y Scalar funcionan (contrato `openapi.test.ts`).
- [x] Docker build funciona (podman, imagen 0.10.0).
- [x] CI pasa — verificado localmente ejecutando los comandos de los 8 jobs
  (lint, typecheck, test, openapi-validation, docker-build, migraciones,
  integración, migración).

### Persistencia

- [x] `data-api` levanta PostgreSQL (`db:up` + perfil `database`).
- [x] Migraciones funcionan desde cero (suite de journal from-zero).
- [x] Repositorio ejemplo tiene pruebas reales (`modules/notes`).
- [x] No se usa `push` en producción (migraciones SQL commitadas, `db:migrate`).

### Auth

- [x] Registro/login/sesión/revocación funcionan (suites de DB reales;
  revocación ante cambios críticos diferida).
- [x] Better Auth está encapsulado (`packages/auth`).
- [x] Secrets y cookies configurados de forma segura (validación de entorno,
  atributos de cookie testeados).
- [x] Existe una estrategia documentada para web, móvil y escritorio (Fase 9).

### Single-tenant

- [x] No incluye tablas de organizaciones (poda física de los perfiles sin
  tenancy).
- [x] Roles globales son opcionales (feature `authorization` seleccionable).
- [x] Auditoría puede activarse (feature `audit` seleccionable).

### Multi-tenant

- [x] Organización, membresía e invitación funcionan.
- [x] Último owner no puede abandonar.
- [x] Transferencia de ownership es transaccional.
- [x] Todos los recursos tenant requieren tenant scope.
- [x] Suite A/B de aislamiento pasa (IDOR/isolation).
- [x] Frontend no es autoridad de permisos.
- [x] Auditoría registra cambios críticos.

### Integraciones

- [x] API keys se almacenan de forma segura (solo-hash sha256).
- [x] Webhooks están firmados (HMAC timing-safe).
- [x] Reintentos e idempotencia funcionan (outbox, jobs, `idempotency-key`).
- [x] Outbox evita eventos antes del commit (emisión en la misma transacción).
- [x] Worker se puede ejecutar separado (perfil `worker`, shutdown graceful).

### Generador

- [x] Genera todos los perfiles (minimal, data-api, authenticated,
  multi-tenant, platform).
- [x] No arrastra dependencias innecesarias (poda física verificada).
- [x] Impide combinaciones inválidas (`generator:validate`).
- [x] Genera documentación y AGENTS.md (GENERATED.md; AGENTS.md/README se
  copian tal cual).
- [x] Cada proyecto generado pasa lint, types, tests y Docker build —
  generación e2e verificada (minimal, multi-tenant); el build Docker del
  proyecto generado no se repitió en esta validación (los gates del proyecto
  generado son los mismos comandos de este reporte).

### Contrato

- [x] Todas las rutas aparecen en OpenAPI (`openapi.test.ts`).
- [x] Todas las respuestas documentadas.
- [x] SDK compila en un repositorio separado (84 tests, sin dependencias de
  runtime).
- [x] TanStack y Next pueden consumirlo (kits + ejemplos).
- [x] Existe ejemplo Ignite/Tauri (`integrations/`).
- [ ] n8n puede consumir REST sin Hono RPC — **diferido** (decisión del
  usuario; el contrato REST es consumible por cualquier cliente HTTP).

### Calidad

- [x] No existen dependencias `"latest"` (pins exactos + lockfile).
- [x] Arquitectura validada automáticamente (gates de lint/typecheck/tests/
  cobertura/contrato).
- [x] No hay lógica de negocio en handlers.
- [x] No hay consultas tenant sin scope.
- [x] No hay secretos en logs (redacción testada).
- [x] README y runbooks están completos (este WU cierra la documentación).
- [x] CHANGELOG inicial y versión — consolidado a `0.10.0` en este WU.
