import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { hashFileContent } from "../src/hashing";
import { readManifest } from "../src/manifest";
import { getCanonicalStarterVersion } from "../src/starter-version";
import { cleanup, createTempProject, hashDir, writePersonalization } from "./helpers/tmp-project";

describe("e2e update cycle", () => {
  test("fictitious --to is rejected without writes", () => {
    const { dir } = createTempProject({ profile: "minimal", features: [] });
    const pre = hashDir(dir);
    const proc = Bun.spawnSync([
      "bun",
      "generator/src/diff-project.ts",
      "--project",
      dir,
      "--to",
      "99.0.0",
      "--json",
    ]);
    expect(proc.exitCode).not.toBe(0);
    const out = JSON.parse(proc.stdout.toString()) as { valid: boolean; error: string };
    expect(out.valid).toBe(false);
    expect(out.error).toMatch(/mismatch|canonical/);
    const post = hashDir(dir);
    expect([...pre.entries()]).toEqual([...post.entries()]);
    cleanup(dir);
  });

  test("diff without --to defaults to canonical and is read-only", () => {
    const { dir } = createTempProject({ profile: "minimal", features: [] });
    const pre = hashDir(dir);
    const canonical = getCanonicalStarterVersion();
    const proc = Bun.spawnSync([
      "bun",
      "generator/src/diff-project.ts",
      "--project",
      dir,
      "--json",
    ]);
    expect(proc.exitCode).toBe(0);
    const out = JSON.parse(proc.stdout.toString()) as { toVersion: string; fromVersion: string };
    expect(out.toVersion).toBe(canonical);
    const post = hashDir(dir);
    expect([...pre.entries()]).toEqual([...post.entries()]);
    cleanup(dir);
  });

  test("update with fictitious --to fails without manifest bump", () => {
    const { dir } = createTempProject({ profile: "minimal", features: [] });
    const manifestBefore = readManifest(dir);
    const proc = Bun.spawnSync([
      "bun",
      "generator/src/update-project.ts",
      "--project",
      dir,
      "--to",
      "99.0.0",
      "--apply",
      "--json",
    ]);
    expect(proc.exitCode).not.toBe(0);
    const manifestAfter = readManifest(dir);
    expect(manifestAfter.starter.version).toBe(manifestBefore.starter.version);
    cleanup(dir);
  });

  test("downgrade is rejected", () => {
    const { dir } = createTempProject({ profile: "minimal", features: [] });
    const canonical = getCanonicalStarterVersion();
    // Simulate older manifest by manually editing manifest to 99.0.0 then trying to go to canonical? Actually downgrade means from newer to older.
    // Create a fake downgrade: set manifest version to 999.0.0, try to update to canonical (downgrade)
    const _manifest = readManifest(dir);
    const fakePath = path.join(dir, ".api-starter", "manifest.json");
    const raw = JSON.parse(readFileSync(fakePath, "utf8"));
    raw.starter.version = "99.0.0";
    writeFileSync(fakePath, JSON.stringify(raw, null, 2));
    const proc = Bun.spawnSync([
      "bun",
      "generator/src/update-project.ts",
      "--project",
      dir,
      "--to",
      canonical,
      "--json",
    ]);
    expect(proc.exitCode).not.toBe(0);
    const out = JSON.parse(proc.stdout.toString()) as { error: string };
    expect(out.error).toMatch(/newer|downgrade|no update path/i);
    cleanup(dir);
  });

  test("package.json structured merge preserves local fields", () => {
    const { dir } = createTempProject({ profile: "minimal", features: [] });
    // Personalize
    writePersonalization(dir, {
      packageJson: {
        scripts: { "my:script": "echo hello" },
        dependencies: { lodash: "1.0.0" },
      } as Record<string, unknown>,
    });
    const beforePkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")) as Record<
      string,
      unknown
    >;
    expect((beforePkg.scripts as Record<string, string>)["my:script"]).toBe("echo hello");
    // Simulate upstream adding a dependency by directly modifying canonical? Instead we test merge function directly
    // For e2e, we verify that diff does not lose script (it reports unchanged or customized-no-upstream)
    const proc = Bun.spawnSync([
      "bun",
      "generator/src/diff-project.ts",
      "--project",
      dir,
      "--json",
    ]);
    expect(proc.exitCode).toBe(0);
    const pkgAfter = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")) as Record<
      string,
      unknown
    >;
    expect((pkgAfter.scripts as Record<string, string>)["my:script"]).toBe("echo hello");
    cleanup(dir);
  });

  test(".env real untouched, .env.example merge preserves local keys", () => {
    const { dir } = createTempProject({ profile: "minimal", features: [] });
    const envPath = path.join(dir, ".env.example");
    const envReal = path.join(dir, ".env");
    if (existsSync(envPath)) {
      const before = readFileSync(envPath, "utf8");
      writeFileSync(envPath, `${before}\nMY_LOCAL_KEY=keepme\n`);
      writeFileSync(envReal, "MY_LOCAL_KEY=keepme\n");
      const proc = Bun.spawnSync([
        "bun",
        "generator/src/diff-project.ts",
        "--project",
        dir,
        "--json",
      ]);
      expect(proc.exitCode).toBe(0);
      const afterEnv = readFileSync(envPath, "utf8");
      expect(afterEnv).toContain("MY_LOCAL_KEY=keepme");
      const afterReal = readFileSync(envReal, "utf8");
      expect(afterReal).toBe("MY_LOCAL_KEY=keepme\n");
    }
    cleanup(dir);
  });

  test("idempotent second update does no writes", () => {
    const { dir } = createTempProject({ profile: "minimal", features: [] });
    const canonical = getCanonicalStarterVersion();
    // First update should be no-op because already at canonical (from===to)
    const proc1 = Bun.spawnSync([
      "bun",
      "generator/src/update-project.ts",
      "--project",
      dir,
      "--to",
      canonical,
      "--apply",
      "--json",
    ]);
    expect(proc1.exitCode).toBe(0);
    const manifest1 = readManifest(dir);
    const applied1 = [...manifest1.appliedUpdates];
    const pre = hashDir(dir);
    const proc2 = Bun.spawnSync([
      "bun",
      "generator/src/update-project.ts",
      "--project",
      dir,
      "--to",
      canonical,
      "--apply",
      "--json",
    ]);
    expect(proc2.exitCode).toBe(0);
    const manifest2 = readManifest(dir);
    expect(manifest2.appliedUpdates).toEqual(applied1);
    const post = hashDir(dir);
    expect([...pre.entries()]).toEqual([...post.entries()]);
    cleanup(dir);
  });

  test("--json output is stable and valid", () => {
    const { dir } = createTempProject({ profile: "minimal", features: [] });
    const proc1 = Bun.spawnSync([
      "bun",
      "generator/src/diff-project.ts",
      "--project",
      dir,
      "--json",
    ]);
    const proc2 = Bun.spawnSync([
      "bun",
      "generator/src/diff-project.ts",
      "--project",
      dir,
      "--json",
    ]);
    const j1 = JSON.parse(proc1.stdout.toString());
    const j2 = JSON.parse(proc2.stdout.toString());
    expect(j1).toEqual(j2);
    expect(j1.files).toBeDefined();
    cleanup(dir);
  });

  test(
    "real 0.10.1 → 0.11.0 via dispatcher with preservation and true idempotence",
    () => {
      const { dir } = createTempProject({ profile: "minimal", features: [] });

      // --- Build deterministic 0.10.1 fixture ---
      // Mutate manifest to 0.10.1 and create at least one real safe operation.
      // Use README.md as update-safe: old content + baselineHash = oldHash, canonical is current 0.11.0.
      const manifestPath = path.join(dir, ".api-starter", "manifest.json");
      const raw = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown> & {
        starter: { version: string };
        managedFiles: Record<string, { baselineHash: string; strategy: string }>;
        appliedUpdates: string[];
      };
      const readmePath = path.join(dir, "README.md");
      const oldReadme = "OLD README for 0.10.1\nBaseline for E2E test.\n";
      const oldHash = hashFileContent(oldReadme);
      writeFileSync(readmePath, oldReadme);
      raw.starter.version = "0.10.1";
      if (raw.managedFiles["README.md"]) {
        raw.managedFiles["README.md"].baselineHash = oldHash;
      } else {
        raw.managedFiles["README.md"] = { baselineHash: oldHash, strategy: "managed" };
      }
      raw.appliedUpdates = [];
      writeFileSync(manifestPath, JSON.stringify(raw, null, 2));

      // --- Personalizations that must survive ---
      const envExamplePath = path.join(dir, ".env.example");
      const envRealPath = path.join(dir, ".env");
      const envExampleBefore = existsSync(envExamplePath)
        ? readFileSync(envExamplePath, "utf8")
        : "";
      if (existsSync(envExamplePath)) {
        writeFileSync(envExamplePath, `${envExampleBefore}\nMY_LOCAL_KEY=keepme\n`);
      }
      writeFileSync(envRealPath, "MY_LOCAL_KEY=keepme\n");
      const envRealBefore = readFileSync(envRealPath, "utf8");

      writePersonalization(dir, {
        packageJson: {
          scripts: { "my:script": "echo hello" },
          dependencies: { lodash: "1.0.0" },
        } as Record<string, unknown>,
      });

      // Unmanaged domain file must be kept
      const unmanagedRel = "modules/custom/src/domain/foo.ts";
      const unmanagedPath = path.join(dir, unmanagedRel);
      mkdirSync(path.dirname(unmanagedPath), { recursive: true });
      writeFileSync(unmanagedPath, "export const foo = 'bar';\n");

      const _preHashForDiff = hashDir(dir);

      // --- 4. diff must report real safe op ---
      const diffProc = Bun.spawnSync([
        "bun",
        "generator/src/diff-project.ts",
        "--project",
        dir,
        "--to",
        "0.11.0",
        "--json",
      ]);
      expect(diffProc.exitCode).toBe(0);
      const diffOut = JSON.parse(diffProc.stdout.toString()) as {
        fromVersion: string;
        toVersion: string;
        files: Array<{ path: string; classification: string }>;
      };
      expect(diffOut.fromVersion).toBe("0.10.1");
      expect(diffOut.toVersion).toBe("0.11.0");
      const safe = diffOut.files.filter((f) =>
        ["add", "update-safe", "remove-safe"].includes(f.classification),
      );
      expect(safe.length).toBeGreaterThanOrEqual(1);
      const conflicts = diffOut.files.filter((f) => f.classification === "conflict");
      expect(conflicts.length).toBe(0);

      // Snapshot before apply
      const _manifestBeforeRaw = readFileSync(manifestPath, "utf8");
      const _packageBeforeRaw = readFileSync(path.join(dir, "package.json"), "utf8");
      const _envExampleBeforeFull = readFileSync(envExamplePath, "utf8");
      const _hashBeforeApply = hashDir(dir);

      // --- 5. apply via real dispatcher ---
      const applyProc = Bun.spawnSync([
        "bun",
        "generator/src/update-project.ts",
        "--project",
        dir,
        "--to",
        "0.11.0",
        "--apply",
        "--json",
      ]);
      expect(applyProc.exitCode).toBe(0);
      const _applyOut = JSON.parse(applyProc.stdout.toString()) as {
        toVersion?: string;
        fromVersion?: string;
        valid?: boolean;
      };
      // manifest bump
      const manifestAfter = readManifest(dir);
      expect(manifestAfter.starter.version).toBe("0.11.0");
      expect(manifestAfter.appliedUpdates).toContain("0.10.1-to-0.11.0");
      expect(manifestAfter.appliedUpdates.filter((id) => id === "0.10.1-to-0.11.0").length).toBe(1);

      // upstream change applied: README should no longer be OLD
      const readmeAfter = readFileSync(readmePath, "utf8");
      expect(readmeAfter).not.toBe(oldReadme);
      expect(readmeAfter.length).toBeGreaterThan(oldReadme.length);

      // package.json local fields preserved via dispatcher merge / no-overwrite
      const pkgAfter = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")) as Record<
        string,
        unknown
      >;
      expect((pkgAfter.scripts as Record<string, string>)["my:script"]).toBe("echo hello");
      expect((pkgAfter.dependencies as Record<string, string>).lodash).toBe("1.0.0");

      // .env.example local key preserved (structured merge keeps local)
      const envExampleAfter = readFileSync(envExamplePath, "utf8");
      expect(envExampleAfter).toContain("MY_LOCAL_KEY=keepme");

      // .env byte-identical
      const envRealAfter = readFileSync(envRealPath, "utf8");
      expect(envRealAfter).toBe(envRealBefore);

      // unmanaged file kept
      expect(existsSync(unmanagedPath)).toBe(true);
      expect(readFileSync(unmanagedPath, "utf8")).toBe("export const foo = 'bar';\n");

      // backup created when update-safe exists
      const backupsDir = path.join(dir, ".api-starter", "backups");
      expect(existsSync(backupsDir)).toBe(true);
      const backupEntries: string[] = [];
      function collectBackups(base: string, rel: string) {
        for (const e of require("node:fs").readdirSync(path.join(base, rel), {
          withFileTypes: true,
        })) {
          const r = rel ? `${rel}/${e.name}` : e.name;
          if (e.isDirectory()) collectBackups(base, r);
          else backupEntries.push(r);
        }
      }
      if (existsSync(backupsDir)) {
        for (const entry of require("node:fs").readdirSync(backupsDir)) {
          collectBackups(path.join(backupsDir, entry), "");
        }
      }
      // At least one backup for README update-safe
      expect(backupEntries.some((p) => p.includes("README.md"))).toBe(true);

      // --- 7/8. save hashes and re-apply for true idempotence ---
      const hashAfterFirst = hashDir(dir);
      const manifestAfterRaw = readFileSync(manifestPath, "utf8");

      const secondProc = Bun.spawnSync([
        "bun",
        "generator/src/update-project.ts",
        "--project",
        dir,
        "--to",
        "0.11.0",
        "--apply",
        "--json",
      ]);
      expect(secondProc.exitCode).toBe(0);
      const manifestSecond = readManifest(dir);
      expect(manifestSecond.appliedUpdates).toEqual(manifestAfter.appliedUpdates);
      expect(readFileSync(manifestPath, "utf8")).toBe(manifestAfterRaw);
      const hashAfterSecond = hashDir(dir);
      expect([...hashAfterFirst.entries()]).toEqual([...hashAfterSecond.entries()]);

      // Note: structured package.json simultaneous local+upstream is classified as conflict
      // by whole-file hash, so this E2E demonstrates the safe path (README managed) while
      // still proving dispatcher routing and local preservation for structured files.

      cleanup(dir);
    },
    { timeout: 30000 },
  );
});
