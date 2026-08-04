import { closeSync, openSync, readSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

/**
 * Shared helpers for the db:backup / db:restore scripts.
 *
 * Security contract: the password is extracted from the connection URL and
 * passed to pg_dump/pg_restore/psql via the PGPASSWORD environment variable.
 * The child argv only ever contains the URL WITHOUT the password, and every
 * log line goes through `redactUrl`. The password never appears in argv,
 * logs or exceptions.
 */

export interface DbConnectionInfo {
  user: string;
  password: string | null;
  host: string;
  port: string;
  database: string;
  urlWithoutPassword: string;
}

export class DatabaseUrlError extends Error {}

export function parseDatabaseUrl(raw: string): DbConnectionInfo {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new DatabaseUrlError(
      "invalid connection URL (expected postgres://user:pass@host:port/db)",
    );
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new DatabaseUrlError(`unsupported protocol "${url.protocol}" (expected postgres://)`);
  }
  if (url.pathname.length <= 1) {
    throw new DatabaseUrlError("connection URL is missing a database name");
  }
  const withoutPassword = new URL(url);
  withoutPassword.password = "";
  return {
    user: url.username,
    password: url.password === "" ? null : url.password,
    host: url.hostname,
    port: url.port,
    database: decodeURIComponent(url.pathname.slice(1)),
    urlWithoutPassword: withoutPassword.href,
  };
}

/** Masks the password of a connection URL for safe logging. */
export function redactUrl(raw: string): string {
  try {
    const url = new URL(raw);
    if (url.password !== "") {
      url.password = "***";
    }
    return url.href;
  } catch {
    return raw;
  }
}

export function backupFileName(database: string, now: Date): string {
  const stamp = now.toISOString().slice(0, 19).replaceAll(":", "").replace("T", "-");
  return `backup-${database}-${stamp}.dump`;
}

export interface CliArgs {
  values: Map<string, string>;
  switches: Set<string>;
}

/** Parses `--key value` / `--key=value` pairs and bare `--switch` flags. */
export function parseCliArgs(argv: string[]): CliArgs {
  const values = new Map<string, string>();
  const switches = new Set<string>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? "";
    const eq = arg.indexOf("=");
    if (arg.startsWith("--") && eq !== -1) {
      values.set(arg.slice(2, eq), arg.slice(eq + 1));
    } else if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        values.set(key, next);
        i += 1;
      } else {
        switches.add(key);
      }
    }
  }
  return { values, switches };
}

export class UsageError extends Error {
  constructor(public readonly usage: string) {
    super(usage);
  }
}

/** Resolves a pg client tool: an env override (path or whitespace-separated
 * command, e.g. "podman run ... pg_dump") or the default PATH binary. */
export function resolveBinary(envName: string, fallback: string): string[] {
  const override = process.env[envName];
  if (override !== undefined && override.trim() !== "") {
    return override.trim().split(/\s+/);
  }
  return [fallback];
}

export async function spawnCli(
  argv: string[],
  extraEnv: Record<string, string>,
  label: string,
): Promise<void> {
  const env = { ...process.env, ...extraEnv };
  if (extraEnv.PGPASSWORD === undefined) {
    delete env.PGPASSWORD;
  }
  const proc = Bun.spawn(argv, { env, stdout: "inherit", stderr: "inherit" });
  const code = await proc.exited;
  if (code !== 0) {
    throw new Error(`${label} exited with code ${code}`);
  }
}

export function buildBackupArgs(
  pgDump: string[],
  info: DbConnectionInfo,
  filePath: string,
): string[] {
  return [
    ...pgDump,
    "--format=custom",
    "--no-password",
    "--file",
    filePath,
    info.urlWithoutPassword,
  ];
}

export async function runBackup(
  options: { outDir: string; url: string },
  pgDump: string[] = resolveBinary("PG_DUMP", "pg_dump"),
  now: Date = new Date(),
): Promise<string> {
  const info = parseDatabaseUrl(options.url);
  const outDir = resolve(options.outDir);
  await mkdir(outDir, { recursive: true });
  const filePath = join(outDir, backupFileName(info.database, now));
  await spawnCli(
    buildBackupArgs(pgDump, info, filePath),
    info.password === null ? {} : { PGPASSWORD: info.password },
    "pg_dump",
  );
  return filePath;
}

/** Custom-format archives start with the "PGDMP" magic bytes; anything else
 * (plain SQL from pg_dump --format=plain) is restored via psql. */
export function detectDumpFormat(filePath: string): "custom" | "plain" {
  const fd = openSync(filePath, "r");
  try {
    const head = Buffer.alloc(5);
    const read = readSync(fd, head, 0, 5, 0);
    return read === 5 && head.toString("latin1") === "PGDMP" ? "custom" : "plain";
  } finally {
    closeSync(fd);
  }
}

export function buildRestoreArgs(
  format: "custom" | "plain",
  binary: string[],
  info: DbConnectionInfo,
  filePath: string,
): string[] {
  if (format === "custom") {
    return [
      ...binary,
      "--clean",
      "--if-exists",
      "--no-password",
      "--dbname",
      info.urlWithoutPassword,
      filePath,
    ];
  }
  return [...binary, "--no-password", "--dbname", info.urlWithoutPassword, "--file", filePath];
}

export async function runRestore(
  options: { file: string; url: string; force: boolean },
  pgRestore: string[] = resolveBinary("PG_RESTORE", "pg_restore"),
  psql: string[] = resolveBinary("PSQL", "psql"),
): Promise<void> {
  if (!options.force) {
    throw new Error(
      "refusing to restore without --force: pg_restore --clean drops existing objects",
    );
  }
  const info = parseDatabaseUrl(options.url);
  const format = detectDumpFormat(options.file);
  const extraEnv = info.password === null ? {} : { PGPASSWORD: info.password };
  await spawnCli(
    buildRestoreArgs(format, format === "custom" ? pgRestore : psql, info, options.file),
    extraEnv,
    format === "custom" ? "pg_restore" : "psql",
  );
}
