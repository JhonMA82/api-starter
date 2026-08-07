import { DatabaseUrlError, parseCliArgs, redactUrl, runBackup, UsageError } from "./pg-utils";

export interface BackupOptions {
  outDir: string;
  url: string;
}

export const BACKUP_USAGE = `Usage: bun run db:backup [--out-dir <dir>] [--url <postgres://...>]

Dumps the database with pg_dump --format=custom into a timestamped archive.
  --out-dir  output directory (default: backups/)
  --url      connection URL (default: $DATABASE_URL)

The password is passed to pg_dump via PGPASSWORD and never appears in argv
or logs. Override the pg_dump binary with PG_DUMP (a path or a command,
e.g. "podman exec postgres pg_dump"). Requires pg_dump on PATH.
See docs/operations/backup-and-restore.md.`;

export function parseBackupArgs(argv: string[], defaultUrl?: string): BackupOptions {
  const parsed = parseCliArgs(argv);
  if (parsed.switches.has("help")) {
    throw new UsageError(BACKUP_USAGE);
  }
  const url = parsed.values.get("url") ?? defaultUrl;
  if (url === undefined) {
    throw new DatabaseUrlError("DATABASE_URL is not set (see .env.example)");
  }
  return { outDir: parsed.values.get("out-dir") ?? "backups", url };
}

async function main(): Promise<void> {
  const options = parseBackupArgs(Bun.argv.slice(2), process.env.DATABASE_URL);
  const filePath = await runBackup(options);
  console.log(`[db:backup] wrote ${filePath} (${redactUrl(options.url)})`);
}

if (import.meta.main) {
  main()
    .then(() => process.exit(0))
    .catch((error: unknown) => {
      if (error instanceof UsageError) {
        console.log(error.usage);
        process.exit(0);
      }
      console.error(`[db:backup] ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    });
}
