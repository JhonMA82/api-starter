import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createClient } from "@consulting/module-notes";

import { parseBackupArgs } from "./backup";
import {
  backupFileName,
  buildBackupArgs,
  buildRestoreArgs,
  DatabaseUrlError,
  detectDumpFormat,
  parseCliArgs,
  parseDatabaseUrl,
  redactUrl,
  resolveBinary,
  runBackup,
  runRestore,
  UsageError,
} from "./pg-utils";
import { parseRestoreArgs as parseRestoreArgsFromRestore } from "./restore";

describe("parseCliArgs", () => {
  test("parses --key value, --key=value and bare switches", () => {
    const parsed = parseCliArgs(["--out-dir", "backups", "--url=x", "--force", "--help"]);
    expect(parsed.values.get("out-dir")).toBe("backups");
    expect(parsed.values.get("url")).toBe("x");
    expect(parsed.switches.has("force")).toBe(true);
    expect(parsed.switches.has("help")).toBe(true);
  });

  test("treats a flag followed by another flag as a switch", () => {
    const parsed = parseCliArgs(["--force", "--help"]);
    expect(parsed.switches.has("force")).toBe(true);
    expect(parsed.switches.has("help")).toBe(true);
  });
});

describe("parseDatabaseUrl", () => {
  const url = "postgres://postgres:s3cr3t@db.internal:5433/consulting";

  test("extracts parts and strips the password for argv", () => {
    const info = parseDatabaseUrl(url);
    expect(info.user).toBe("postgres");
    expect(info.password).toBe("s3cr3t");
    expect(info.host).toBe("db.internal");
    expect(info.port).toBe("5433");
    expect(info.database).toBe("consulting");
    expect(info.urlWithoutPassword).toBe("postgres://postgres@db.internal:5433/consulting");
    expect(info.urlWithoutPassword).not.toContain("s3cr3t");
  });

  test("supports postgresql:// and no password", () => {
    const info = parseDatabaseUrl("postgresql://app@localhost/other");
    expect(info.password).toBeNull();
    expect(info.database).toBe("other");
    expect(info.urlWithoutPassword).toBe("postgresql://app@localhost/other");
  });

  test("rejects non-postgres protocols and URLs without a database", () => {
    expect(() => parseDatabaseUrl("mysql://u:p@h/db")).toThrow(DatabaseUrlError);
    expect(() => parseDatabaseUrl("postgres://u:p@h")).toThrow(DatabaseUrlError);
    expect(() => parseDatabaseUrl("not a url")).toThrow(DatabaseUrlError);
  });
});

describe("redactUrl", () => {
  test("masks the password and never leaks it", () => {
    const redacted = redactUrl("postgres://postgres:s3cr3t@localhost:5432/api");
    expect(redacted).toBe("postgres://postgres:***@localhost:5432/api");
    expect(redacted).not.toContain("s3cr3t");
  });

  test("leaves URLs without a password unchanged", () => {
    expect(redactUrl("postgres://postgres@localhost:5432/api")).toBe(
      "postgres://postgres@localhost:5432/api",
    );
  });
});

describe("backupFileName", () => {
  test("produces a timestamped, database-scoped name (UTC)", () => {
    const now = new Date("2026-08-03T22:30:05.000Z");
    expect(backupFileName("api", now)).toBe("backup-api-2026-08-03-223005.dump");
  });
});

describe("buildBackupArgs / buildRestoreArgs", () => {
  const info = parseDatabaseUrl("postgres://postgres:pw-with-@-sign@localhost:5432/api");

  test("backup argv never contains the password", () => {
    const argv = buildBackupArgs(["pg_dump"], info, "/tmp/backup.dump");
    const joined = argv.join(" ");
    expect(joined).toContain("--format=custom");
    expect(joined).toContain("--no-password");
    expect(joined).toContain("--file /tmp/backup.dump");
    expect(joined).toContain("postgres://postgres@localhost:5432/api");
    expect(joined).not.toContain("pw-with-@-sign");
  });

  test("custom restore argv uses pg_restore --clean --if-exists", () => {
    const argv = buildRestoreArgs("custom", ["pg_restore"], info, "/tmp/backup.dump");
    const joined = argv.join(" ");
    expect(joined).toContain("--clean");
    expect(joined).toContain("--if-exists");
    expect(joined).toContain("--no-password");
    expect(joined).toContain("--dbname postgres://postgres@localhost:5432/api");
    expect(joined).toContain("/tmp/backup.dump");
    expect(joined).not.toContain("pw-with-@-sign");
  });

  test("plain restore argv uses psql", () => {
    const argv = buildRestoreArgs("plain", ["psql"], info, "/tmp/backup.sql");
    expect(argv[0]).toBe("psql");
    expect(argv.join(" ")).toContain("--file /tmp/backup.sql");
  });
});

describe("detectDumpFormat", () => {
  test("PGDMP magic bytes mean custom format", async () => {
    const dir = await mkdtemp(join(tmpdir(), "fmt-"));
    const file = join(dir, "x.dump");
    await writeFile(file, "PGDMP\x00\x0e\x00\x00\x00\x02rest");
    expect(detectDumpFormat(file)).toBe("custom");
    await rm(dir, { recursive: true, force: true });
  });

  test("anything else is treated as plain SQL", async () => {
    const dir = await mkdtemp(join(tmpdir(), "fmt-"));
    const file = join(dir, "x.sql");
    await writeFile(file, "-- PostgreSQL database dump\n");
    expect(detectDumpFormat(file)).toBe("plain");
    await rm(dir, { recursive: true, force: true });
  });
});

describe("resolveBinary", () => {
  test("env override wins and is split on whitespace", () => {
    process.env.PG_DUMP = "podman exec api-pg pg_dump";
    expect(resolveBinary("PG_DUMP", "pg_dump")).toEqual(["podman", "exec", "api-pg", "pg_dump"]);
    delete process.env.PG_DUMP;
    expect(resolveBinary("PG_DUMP", "pg_dump")).toEqual(["pg_dump"]);
  });
});

describe("parseBackupArgs", () => {
  test("defaults to backups/ and the provided DATABASE_URL", () => {
    const options = parseBackupArgs([], "postgres://postgres@localhost/api");
    expect(options).toEqual({ outDir: "backups", url: "postgres://postgres@localhost/api" });
  });

  test("honors --out-dir and --url", () => {
    const options = parseBackupArgs(
      ["--out-dir", "/tmp/dumps", "--url", "postgres://u@h/db"],
      "postgres://u@h/default",
    );
    expect(options).toEqual({
      outDir: "/tmp/dumps",
      url: "postgres://u@h/db",
    });
  });

  test("--help raises UsageError", () => {
    expect(() => parseBackupArgs(["--help"])).toThrow(UsageError);
  });

  test("missing URL is an error", () => {
    expect(() => parseBackupArgs([])).toThrow(DatabaseUrlError);
  });
});

describe("parseRestoreArgs", () => {
  test("requires --file and --force", () => {
    expect(() => parseRestoreArgsFromRestore([], "postgres://u@h/db")).toThrow(UsageError);
    const options = parseRestoreArgsFromRestore(
      ["--file", "/tmp/x.dump", "--force"],
      "postgres://u@h/db",
    );
    expect(options).toEqual({ file: "/tmp/x.dump", url: "postgres://u@h/db", force: true });
  });

  test("missing --force is not a parse error but runRestore refuses", async () => {
    const dir = await mkdtemp(join(tmpdir(), "restore-"));
    const file = join(dir, "x.dump");
    await writeFile(file, "PGDMP\x00\x0e\x00\x00\x00\x02rest");
    const options = parseRestoreArgsFromRestore(
      ["--file", file],
      "postgres://postgres@localhost:5432/api",
    );
    expect(options.force).toBe(false);
    await expect(runRestore(options, ["pg_restore"])).rejects.toThrow(/--force/);
    await rm(dir, { recursive: true, force: true });
  });

  test("--help raises UsageError", () => {
    expect(() => parseRestoreArgsFromRestore(["--help"])).toThrow(UsageError);
  });
});

const databaseUrl = process.env.DATABASE_URL;

async function probeBinary(argv: string[]): Promise<boolean> {
  try {
    const proc = Bun.spawn([...argv, "--version"], { stdout: "pipe", stderr: "pipe" });
    return (await proc.exited) === 0;
  } catch {
    return false;
  }
}

async function probeDatabase(url: string): Promise<boolean> {
  const client = createClient(url);
  try {
    await client`select 1`;
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => {});
  }
}

function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.href;
}

const pgDump = resolveBinary("PG_DUMP", "pg_dump");
const pgRestore = resolveBinary("PG_RESTORE", "pg_restore");

let toolsAvailable = false;
let dbAvailable = false;
let availabilityChecked = false;
let availabilityMessage = "";

async function checkAvailability(): Promise<void> {
  if (availabilityChecked) {
    return;
  }
  availabilityChecked = true;
  toolsAvailable = (await probeBinary(pgDump)) && (await probeBinary(pgRestore));
  if (!toolsAvailable) {
    availabilityMessage =
      "[backup/restore] pg_dump/pg_restore not available (PATH or PG_DUMP/PG_RESTORE override); skipping real-DB backup tests";
    return;
  }
  if (databaseUrl === undefined) {
    dbAvailable = false;
    availabilityMessage =
      "[backup/restore] DATABASE_URL is not set (see .env.example); skipping real-DB backup tests";
    return;
  }
  dbAvailable = await probeDatabase(databaseUrl);
  availabilityMessage = dbAvailable
    ? ""
    : "[backup/restore] DATABASE_URL is not reachable; skipping real-DB backup tests";
}

describe("backup/restore scripts (real database)", () => {
  test("availability probe", async () => {
    await checkAvailability();
    if (!toolsAvailable || !dbAvailable) {
      console.warn(availabilityMessage);
    }
  });

  test("real backup to a temp dir and scratch-database restore", async () => {
    await checkAvailability();
    if (!toolsAvailable || !dbAvailable) {
      return;
    }
    const tmpDir = await mkdtemp(join(tmpdir(), "db-backup-"));
    const scratchDb = `api_backup_restore_${Date.now()}`;
    const adminClient = createClient(databaseUrl as string);
    try {
      const filePath = await runBackup({ outDir: tmpDir, url: databaseUrl as string }, pgDump);

      const backup = await stat(filePath);
      expect(backup.size).toBeGreaterThan(0);
      const head = (await readFile(filePath)).subarray(0, 5).toString("latin1");
      expect(head).toBe("PGDMP");

      const list = Bun.spawn([...pgRestore, "--list", filePath], {
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(await list.exited).toBe(0);
      const listText = await new Response(list.stdout).text();
      // Backup of an empty DB may have no TABLE DATA, but must be a valid dump
      expect(listText.length).toBeGreaterThan(0);
      expect(listText).toMatch(/;|TABLE DATA/);

      await adminClient.unsafe(`CREATE DATABASE ${scratchDb}`);
      await runRestore(
        { file: filePath, url: withDatabase(databaseUrl as string, scratchDb), force: true },
        pgRestore,
      );

      const check = createClient(withDatabase(databaseUrl as string, scratchDb));
      const tables = await check`
          select table_name from information_schema.tables
          where table_schema = 'public' and table_type = 'BASE TABLE'`;
      expect(tables.length).toBeGreaterThan(0);
      await check.end();
    } finally {
      await adminClient.unsafe(`DROP DATABASE IF EXISTS ${scratchDb} WITH (FORCE)`).catch(() => {});
      await adminClient.end().catch(() => {});
      await rm(tmpDir, { recursive: true, force: true });
    }
  }, 120_000);
});
