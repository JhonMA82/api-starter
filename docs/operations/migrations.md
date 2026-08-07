# Runbook de migraciones

- **Audiencia:** desarrolladores de proyectos con persistencia y operadores.
- **Prerrequisitos:** `.env` con `DATABASE_URL`, podman o Docker para la base local, `bun run db:up` si usas el postgres del contenedor.
- **Riesgo:** medio — aplicar una migración es irreversible (no hay down-migrations); las destructivas exigen revisión y backup previo.
- **Última revisión:** 2026-08-06 (v0.11.0).

Guía operativa para crear, aplicar y revisar migraciones de base de datos con
Drizzle + postgres.js. Ver ADR-0005 para la decisión técnica.

## Flujo local (quick path)

1. `cp .env.example .env` — `DATABASE_URL` es obligatorio.
2. `bun run db:up` — levanta PostgreSQL 17 en el contenedor `api-pg` (volumen
   `api-pg-data` persiste los datos).
3. `bun run db:migrate` — aplica todas las migraciones pendientes.
4. `bun run db:seed` — carga los datos semilla (idempotente: re-ejecutar
   inserta 0 filas).
5. `bun run db:down` — detiene y elimina el contenedor (el volumen se
   conserva).

Para ejecutar los tests de base de datos reales (se saltan si `DATABASE_URL`
no está definido):

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5432/api bun test --parallel=1
```

## Crear una migración

1. Edita el schema en `modules/*/src/infrastructure/*.schema.ts`.
2. Genera el SQL y los snapshots:

   ```bash
   bun run db:generate    # equivale a: bun x drizzle-kit generate < /dev/null
   ```

   El guard `< /dev/null` evita prompts interactivos de rename en CI.
3. Revisa el SQL generado en `migrations/000N_*.sql`.
4. Commitea el SQL **y** los metadatos (`migrations/meta/`) en el mismo
   commit que el cambio de schema. Los commits de CI lo verifican solo.

## Reglas

| Regla | Detalle |
|---|---|
| Append-only | Las migraciones ya aplicadas (desplegadas) **nunca se editan**. |
| Migraciones destructivas | Documenta en el mensaje del commit cualquier DROP o cambio destructivo (p.ej. `migrate: drop column ...`). |
| Rollback | Restaurar un backup. Drizzle no genera down-migrations. |
| Forward-fix | Un cambio incorrecto se corrige con una **nueva** migración, no editando la anterior. |
| `push` | `drizzle-kit push` está **prohibido en producción**; es solo para desarrollo local. |
| Bookkeeping | El migrador registra cada aplicación en `drizzle.__drizzle_migrations` (id serial, hash, created_at); re-ejecutar es un no-op. |
| Un solo lote | Todas las migraciones pendientes se aplican en **una** transacción. |

## Gate de drift en CI

El job `migrations-check` ejecuta `bun run db:generate` y luego
`git diff --exit-code`: si el schema y las migraciones commitadas divergen, el
job falla. `drizzle-kit check` NO detecta drift — generate + diff es el gate.

## Verificación de éxito

- `bun run db:migrate` termina sin errores; re-ejecutar es un no-op.
- `bun run db:generate` + `git diff --exit-code` sin cambios (gate de drift).
- En un proyecto generado con actualizaciones pendientes: `generator:doctor` no reporta migraciones no aplicadas.

## Rollback y recuperación

- Drizzle no genera down-migrations: **restaurar un backup** (`bun run db:restore --file ... --force`, ver [backup-and-restore.md](backup-and-restore.md)).
- Un cambio incorrecto se corrige con una migración nueva (forward-fix), nunca editando la ya aplicada.
- Las migraciones aplicadas son append-only; editarlas rompe el hash del journal y el gate de drift.

## Troubleshooting

| Síntoma | Solución |
|---|---|
| Puerto 5432 ocupado | Otra instancia de postgres local: deténla o cambia el mapeo `-p 5432:5432` en `db:up`. |
| Contenedor `api-pg` existente | `db:up` siempre lo recrea (`podman rm -f api-pg`); el volumen conserva los datos. |
| `db:migrate` falla con "DATABASE_URL is not set" | Revisa `.env` (`cp .env.example .env`) — Bun lo carga automáticamente con `bun run`. |
| Sin podman | Alternativa Docker: `docker compose --profile database up -d postgres` y sigue con `db:migrate`/`db:seed`. |
