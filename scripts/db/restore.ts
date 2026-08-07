import { DatabaseUrlError, parseCliArgs, redactUrl, runRestore, UsageError } from "./pg-utils";

export interface RestoreOptions {
  file: string;
  url: string;
  force: boolean;
}

export const RESTORE_USAGE = `Usage: bun run db:restore --file <archive> [--url <postgres://...>] --force

Restores a backup archive into an EXISTING database. Destructive: requires
--force (custom-format archives restore with pg_restore --clean --if-exists,
dropping conflicting objects before recreating them).
  --file   backup archive (custom-format .dump or plain SQL)
  --url    connection URL of the target database (default: $DATABASE_URL)
  --force  required; acknowledges the destructive restore

The password is passed to pg_restore/psql via PGPASSWORD and never appears
in argv or logs. Override the binaries with PG_RESTORE / PSQL (a path or a
command). Requires pg_restore and psql on PATH.
See docs/operations/backup-and-restore.md.`;

export function parseRestoreArgs(argv: string[], defaultUrl?: string): RestoreOptions {
  const parsed = parseCliArgs(argv);
  if (parsed.switches.has("help")) {
    throw new UsageError(RESTORE_USAGE);
  }
  const file = parsed.values.get("file");
  if (file === undefined || file === "") {
    throw new UsageError(RESTORE_USAGE);
  }
  const url = parsed.values.get("url") ?? defaultUrl;
  if (url === undefined) {
    throw new DatabaseUrlError("DATABASE_URL is not set (see .env.example)");
  }
  return { file, url, force: parsed.switches.has("force") };
}

async function main(): Promise<void> {
  const options = parseRestoreArgs(Bun.argv.slice(2), process.env.DATABASE_URL);
  await runRestore(options);
  console.log(`[db:restore] restored ${options.file} into ${redactUrl(options.url)}`);
}

if (import.meta.main) {
  main()
    .then(() => process.exit(0))
    .catch((error: unknown) => {
      if (error instanceof UsageError) {
        console.log(error.usage);
        process.exit(0);
      }
      console.error(`[db:restore] ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    });
}
