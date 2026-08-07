# Resultados de la prueba de carga

> **HISTÓRICO** — Medición puntual (2026-08-03) en una máquina local. No es una garantía permanente de rendimiento. Cómo ejecutar la carga hoy: [`docs/operations/load-testing.md`](../../operations/load-testing.md).

Fecha: 2026-08-03. Herramienta: `scripts/load-test.ts` (Bun only, sin
dependencias). Servidor: `@consulting/api` en localhost.

## Entorno

- Maquina local (Linux), `bun 1.3.14` (`/home/juan/.bun/bin/bun`).
- API levantada con `bun apps/api/src/server.ts` (config del `.env` de
  desarrollo), `LOG_LEVEL=info`, sirviendo en `http://localhost:3000`.
- Cada run: 10 s de duracion, 20 workers concurrentes, tasa ilimitada
  (salvo el run de verificacion del rate limit).
- Script: `bun scripts/load-test.ts --duration=10 --concurrency=20 --path=<ruta>`.

## Resultados

### 1. `GET /health` — primer run (arranque en frio)

```json
{
  "url": "http://localhost:3000",
  "path": "/health",
  "durationSeconds": 10,
  "concurrency": 20,
  "rate": null,
  "total": 2116,
  "successes": 2116,
  "errors": 0,
  "statusCounts": { "200": 2116 },
  "latencies": { "min": 9, "mean": 94.7, "p50": 78, "p90": 176.7, "p95": 223.2, "p99": 279.1, "max": 338.1 },
  "requestsPerSecond": 211.6
}
```

### 2. `GET /health` — segundo run (estado estacionario)

```json
{
  "url": "http://localhost:3000",
  "path": "/health",
  "durationSeconds": 10,
  "concurrency": 20,
  "rate": null,
  "total": 2506,
  "successes": 2506,
  "errors": 0,
  "statusCounts": { "200": 2506 },
  "latencies": { "min": 2.9, "mean": 79.9, "p50": 72, "p90": 146.5, "p95": 174.8, "p99": 238.9, "max": 298.1 },
  "requestsPerSecond": 250.6
}
```

### 3. `GET /api/v1/example/hello?name=load`

```json
{
  "url": "http://localhost:3000",
  "path": "/api/v1/example/hello?name=load",
  "durationSeconds": 10,
  "concurrency": 20,
  "rate": null,
  "total": 1911,
  "successes": 1911,
  "errors": 0,
  "statusCounts": { "200": 1911 },
  "latencies": { "min": 7.5, "mean": 104.5, "p50": 87.7, "p90": 192.8, "p95": 235.4, "p99": 308.4, "max": 501.8 },
  "requestsPerSecond": 191.1
}
```

### 4. `GET /metrics`

```json
{
  "url": "http://localhost:3000",
  "path": "/metrics",
  "durationSeconds": 10,
  "concurrency": 20,
  "rate": null,
  "total": 2312,
  "successes": 2312,
  "errors": 0,
  "statusCounts": { "200": 2312 },
  "latencies": { "min": 9.5, "mean": 87.3, "p50": 80.7, "p90": 143.8, "p95": 175.2, "p99": 270.6, "max": 346 },
  "requestsPerSecond": 231.2
}
```

### 5. Rate limit (verificacion)

`--rate=50` sobre `/health` durante 3 s: 104 requests (34.7 req/s), 0
errores. El gate es conservador: nunca supera el tope, pero puede quedarse
por debajo cuando la carga del servidor hace que un worker tarde mas que su
slot antes de volver al gate.

## Interpretacion

- **0 errores y 0 status != 200 en todos los runs**: las rutas probadas no
  degradan bajo 20 conexiones concurrentes en local.
- **Throughput**: ~190-250 req/s con 20 workers en una sola maquina
  localhost. El p50 de ~72-88 ms es esperable en modo desarrollo: cada
  request atraviesa el pipeline completo (logger JSON, metrics, secure
  headers, auth session, etc.) sin un perfil de produccion.
- **p95 vs objetivo blando (< 100 ms)**: no se alcanza (175-235 ms). Es
  informativo, no un gate: el run 1 es peor que el run 2 (223 vs 175 ms),
  claro efecto de arranque en frio (primer acceso a rutas/parseos, JIT).
- **Observaciones**:
  - El primer run tras arrancar el servidor incluye ruido de calentamiento;
    descartar o repetir el run para comparar estado estacionario.
  - `hello` (query string) es ligeramente mas caro que `/health`, y
    `/metrics` serializa el registry de Prometheus por request; ambos
    dentro de lo esperado.
  - El cuello de botella observado (p90+ subiendo con la concurrencia) es
    caracteristico del loop de eventos de Bun single-thread + logging
    sincrono de cada request, no de estas rutas en particular.
- **Caveats**: resultados de localhost solamente; sin DB ni auth real
  (better-auth no ejecuto consultas); sin red ni TLS; `bun run dev` en
  watch seria mas lento que `bun apps/api/src/server.ts`. Para planificar
  capacidad real usese tooling dedicado (k6/autocannon/wrk) contra un
  entorno con produccion (DB, red, TLS, multiples replicas).
