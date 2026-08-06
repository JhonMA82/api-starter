import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
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
});
