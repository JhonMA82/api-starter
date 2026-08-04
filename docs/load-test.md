# Prueba de carga reproducible

`scripts/load-test.ts` es un generador de carga sin dependencias que usa
exclusivamente el runtime estándar de Bun (`fetch`, `AbortSignal`,
`performance`). Sirve como smoke test y harnés de regresión de rendimiento
local: **no** sustituye a una herramienta de pruebas de carga dedicada
(autocannon, k6, wrk, …) y no debe usarse para planificación de capacidad.

## Cómo ejecutarlo

1. Levanta la API en una terminal:

   ```bash
   bun run dev
   ```

2. En otra terminal, ejecuta el script:

   ```bash
   bun run load-test
   ```

3. (Opcional) Escribe el resumen JSON a un archivo:

   ```bash
   bun run load-test --duration=10 --concurrency=20 --path=/health --summary=/tmp/load-health.json
   ```

## OPCIONES DE CLI

| Opcion                | Valor por defecto                 | Descripción                                                            |
| --------------------- | --------------------------------- | ---------------------------------------------------------------------- |
| `--url=<base>`        | `http://localhost:3000`           | Base URL del servidor objetivo. Debe empezar por `http://` o `https://` |
| `--path=<path>`       | `/health`                         | Ruta a golpear (puede incluir query string)                             |
| `--duration=<s>`      | `10` (máximo 120)                 | Duración del test en segundos                                          |
| `--concurrency=<n>`   | `10` (máximo 200)                 | Número de workers concurrentes                                         |
| `--rate=<n>`          | ilimitado                         | Tope aproximado de requests/segundo                                    |
| `--summary=<archivo>` | —                                 | Escribe el resumen JSON al archivo indicado                            |
| `--help`              | —                                 | Muestra la ayuda                                                       |

Los valores fuera de rango se acotan con un aviso (`clamping`).

## Que significan las metricas

- **requests**: total de peticiones completadas.
- **successes**: peticiones con status 2xx. **errors**: fallos de red o
  timeout (no peticiones 4xx/5xx — esas cuentan como status, no como error).
- **statusCounts**: reparto por status code (ej. `"200": 995`, `"404": 5`).
- **latencies (ms)**: `min`/`max`, `mean` y percentiles `p50`, `p90`, `p95`,
  `p99`. Los percentiles usan interpolación lineal sobre las latencias de
  peticiones completadas; las peticiones con error de red NO se incluyen
  (evita que un timeout distorsione el p99).
- **requestsPerSecond**: `total / durationSeconds`.

## Escenarios recomendados

| Escenario                                         | Comando                                                                               |
| ------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Salud bajo concurrencia                           | `bun run load-test --duration=10 --concurrency=20 --path=/health`                     |
| Versión bajo concurrencia                         | `bun run load-test --duration=10 --concurrency=20 --path=/version`                    |
| Ruta de ejemplo con query                         | `bun run load-test --path=/api/v1/example/hello?name=load --concurrency=5`            |
| Metrics (texto Prometheus)                        | `bun run load-test --path=/metrics --concurrency=5`                                   |
| Tope de tasa para simular carga moderada          | `bun run load-test --rate=50 --duration=30`                                           |

## Umbrales

- Para `/health` en este starter, **p95 < 100 ms** es un objetivo *blando*:
  informativo, no un gate. La máquina local, el modo `dev` y los efectos de
  calentamiento (JIT/primera request) pueden empujar el p95 por encima en
  runs cortos; si el p99 salta tras un run estable, investiga (GC, carga del
  host, otra app en el puerto), no lo atribuyas al primer run.

## Resumen JSON

Con `--summary=<archivo>` se escribe:

```json
{
  "url": "http://localhost:3000",
  "path": "/health",
  "durationSeconds": 10,
  "concurrency": 20,
  "rate": null,
  "total": 15230,
  "successes": 15230,
  "errors": 0,
  "statusCounts": { "200": 15230 },
  "latencies": { "min": 0.3, "mean": 8.1, "p50": 7.9, "p90": 11.2, "p95": 13.0, "p99": 18.4, "max": 41.0 },
  "requestsPerSecond": 1523
}
```

`rate` es `null` cuando no se limitó la tasa. Los resultados reproducibles
del starter se documentan en `docs/load-test-results.md`.

## Integración con CI

El script está pensado para ejecutarse en local. Un job de CI que lanzara
carga real contra un servidor levantado en el runner es fácil de volver
flaky (CPU compartido, arranque en frío); no se añade job de carga. Si
alguna vez se quiere, debe ser un smoke de <5s con umbrales muy laxos (p95
< 500 ms) y solo como job opcional (`workflow_dispatch`).
