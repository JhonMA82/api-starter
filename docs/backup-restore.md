# Backup y restauración de PostgreSQL

Runbook operativo del starter para volcar, restaurar y **probar** los backups
de la base de datos (cierra el control "backups probados" del modelo de amenazas).
Los scripts son `bun run db:backup` / `bun run db:restore`, con formato
custom de `pg_dump` y un contrato de seguridad: la contraseña viaja por la
variable `PGPASSWORD` y **nunca** aparece en argv, logs ni salida.

## Quick path

```bash
# 1. Backup (volcado custom con timestamp en backups/)
bun run db:backup

# 2. Restaurar (DESTRUCTIVO: --force es obligatorio)
bun run db:restore --file backups/backup-api-2026-08-03-223005.dump --force

# 3. Verificar la restauración (drill de "backups probados")
#    restaurar a una DB scratch y comparar conteos, ver sección abajo.
```

## Prerrequisitos

| Requisito | Detalle |
|---|---|
| `pg_dump` / `pg_restore` | PostgreSQL client tools en PATH (17.x). `apt install postgresql-client` (Debian/Ubuntu), `brew install libpq` (macOS) o el binario del contenedor postgres. |
| `psql` | Solo para restaurar volcados en formato plain (SQL). |
| `DATABASE_URL` | Obligatorio (`.env`, ver `.env.example`). Se puede sobreescribir por CLI con `--url`. |
| Postgres 17 | El volcado se hace contra la misma versión de la que se va a restaurar. |

Si los binarios no están en PATH, se pueden apuntar a un entorno
contenedorizado con `PG_DUMP`, `PG_RESTORE` y `PSQL` (una ruta o un comando):

```bash
PG_DUMP="podman exec postgres pg_dump" bun run db:backup
```

## Backup

```bash
bun run db:backup                      # -> backups/backup-api-<timestamp>.dump
bun run db:backup --out-dir /srv/dumps # otro directorio
bun run db:backup --url postgres://u:p@host:5433/db
```

- Formato `custom` de `pg_dump` (`--format=custom`): comprimido y restaurable
  de forma selectiva con `pg_restore`.
- Nombre con timestamp UTC: `backup-<db>-<YYYY-MM-DD-HHmmss>.dump`.
- La contraseña se extrae de la URL y se pasa por `PGPASSWORD`; el argv solo
  contiene la URL sin contraseña y los logs la muestran enmascarada.
- Exit code distinto de 0 si el volcado falla; el archivo queda a medias en
  disco (limpiar manualmente).

## Restauración

```bash
bun run db:restore --file backups/backup-api-2026-08-03-223005.dump --force
bun run db:restore --file backups/backup.sql --url postgres://u:p@host/db --force
```

Reglas:

- `--force` es **obligatorio**: la restauración es destructiva.
- Formato custom → `pg_restore --clean --if-exists` contra la base **existente**
  (drop + recrea solo los objetos presentes en el volcado).
- Formato plain (SQL) → `psql --file`; **no** hace clean: para restaurar sobre
  una base con objetos, usa siempre el formato custom de `db:backup`.
- El password sigue el mismo contrato que en backup.

## Rotación

Programar con cron (o el scheduler del proveedor):

```cron
# diario 02:30, retención gestionada fuera (p.ej. 7 diarios + 4 semanales)
30 2 * * * cd /ruta/al/repo && bun run db:backup --out-dir /var/backups/api
```

El volumen `api-pg-data` de `db:up`/compose se conserva en `db:down`; los
backups deben vivir **fuera** del contenedor y del árbol del repo (la carpeta
`backups/` está excluida del contexto docker, pero no de git).

## Backups probados — drill de verificación

Un backup que nunca se restauró no es un backup. Verificación mínima
periódica (al menos 1 vez al mes):

1. Restaurar el último volcado a una DB scratch:

   ```bash
   bun run db:backup --out-dir /tmp/drill
   # crear la DB scratch y restaurar en ella
   createdb api_restore_drill
   bun run db:restore --file /tmp/drill/backup-api-*.dump --url postgres://postgres:postgres@localhost:5432/api_restore_drill --force
   ```

2. Comparar datos con la base de producción (p.ej. conteos por tabla
   significativa) y ejecutar el gate de migraciones (`bun run db:generate` +
   `git diff --exit-code`) contra la DB restaurada.
3. Soltar la DB scratch.

Los tests automatizados de los scripts (`scripts/db/backup-restore.test.ts`)
hacen exactamente este ciclo — backup real a un directorio temporal, validación
del archivo (`pg_restore --list`) y restauración a una DB scratch — cuando
`pg_dump`/`pg_restore` están disponibles y `DATABASE_URL` es alcanzable; si no,
se saltan con un mensaje claro:

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5432/api bun test scripts/db/backup-restore.test.ts
```

## RPO / RTO (starter)

| Métrica | Valor por defecto | Cómo bajarlo |
|---|---|---|
| RPO | 24 h (backup diario) | Backups más frecuentes (cron horario, WAL archiving fuera de alcance del starter) |
| RTO | ~minutos (restaurar un volcado custom es rápido; el tiempo domina en validar) | Drill mensual, runbook probado, binarios y URLs conocidos |

## Troubleshooting

| Síntoma | Solución |
|---|---|
| `pg_dump exited with code 1` | Revisar `DATABASE_URL` y credenciales; `PGPASSWORD` nunca se loguea a propósito. |
| `pg_dump: error: could not open output file` | El directorio de salida no existe o no es escribible; `db:backup` lo crea, verifica permisos del padre. |
| `pg_restore: error: did not find "PGDMP"` | El archivo no es un volcado custom; si es SQL plain, `db:restore` usa `psql` automáticamente. |
| `refusing to restore without --force` | Restauración destructiva: añade `--force` y confirma que es la DB correcta. |
| Tests reales se saltan | Falta `pg_dump`/`pg_restore` en PATH (o `PG_DUMP`/`PG_RESTORE`) o `DATABASE_URL` no responde; el mensaje del skip lo indica. |

## Checklist de release

- [ ] `bun run db:backup` produce un archivo `.dump` no vacío.
- [ ] `pg_restore --list backups/backup-api-*.dump` valida el archivo.
- [ ] Drill de restauración a DB scratch ejecutado y datos verificados.
- [ ] Rotación programada (cron) con retención definida.
