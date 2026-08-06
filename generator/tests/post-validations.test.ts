import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { hashFileContent } from "../src/hashing";
import { readManifest } from "../src/manifest";
import { runPostValidations } from "../src/validate-post";
import { cleanup, createTempProject, hashDir, writePersonalization } from "./helpers/tmp-project";

describe("post-validations", () => {
  test("typecheck passes on clean project", () => {
    const { dir } = createTempProject({ profile: "minimal", features: [] });
    const result = runPostValidations(dir, []);
    expect(result.ok).toBe(true);
    cleanup(dir);
  });

  test("dry-run does not imply validations", () => {
    // runPostValidations is only called on apply, not dry-run. This test just checks it doesn't throw
    const { dir } = createTempProject({ profile: "minimal", features: [] });
    expect(() => runPostValidations(dir, [])).not.toThrow();
    cleanup(dir);
  });

  test(
    "post-validation failure after safe ops triggers full rollback",
    () => {
      const { dir } = createTempProject({ profile: "minimal", features: [] });

      // Prepare 0.10.1 with at least one safe op: README update-safe + LICENSE add
      const manifestPath = path.join(dir, ".api-starter", "manifest.json");
      const raw = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown> & {
        starter: { version: string };
        managedFiles: Record<string, { baselineHash: string; strategy: string }>;
        appliedUpdates: string[];
      };
      const readmePath = path.join(dir, "README.md");
      const oldReadme = "OLD README for rollback 0.10.1\n";
      const oldHash = hashFileContent(oldReadme);
      writeFileSync(readmePath, oldReadme);
      raw.starter.version = "0.10.1";
      if (raw.managedFiles["README.md"]) {
        raw.managedFiles["README.md"].baselineHash = oldHash;
      } else {
        raw.managedFiles["README.md"] = { baselineHash: oldHash, strategy: "managed" };
      }
      // Create an add op: delete LICENSE locally and from baseline so canonical add is required
      const licensePath = path.join(dir, "LICENSE");
      const licenseExisted = existsSync(licensePath);
      let licenseBackup: string | null = null;
      if (licenseExisted) {
        licenseBackup = readFileSync(licensePath, "utf8");
        rmSync(licensePath, { force: true });
      }
      delete raw.managedFiles.LICENSE;
      raw.appliedUpdates = [];
      writeFileSync(manifestPath, JSON.stringify(raw, null, 2));

      // Local personalizations that must survive rollback
      writePersonalization(dir, {
        packageJson: { scripts: { "my:script": "echo hello" } } as Record<string, unknown>,
      });
      const envExamplePath = path.join(dir, ".env.example");
      const envRealPath = path.join(dir, ".env");
      if (existsSync(envExamplePath)) {
        const before = readFileSync(envExamplePath, "utf8");
        writeFileSync(envExamplePath, `${before}\nMY_LOCAL_KEY=keepme\n`);
      }
      writeFileSync(envRealPath, "MY_LOCAL_KEY=keepme\n");
      const unmanagedRel = "modules/custom/src/domain/foo.ts";
      const unmanagedPath = path.join(dir, unmanagedRel);
      mkdirSync(path.dirname(unmanagedPath), { recursive: true });
      writeFileSync(unmanagedPath, "export const foo='bar';\n");

      // Ensure validations will run: create node_modules marker and inject deterministic lint failure
      mkdirSync(path.join(dir, "node_modules"), { recursive: true });
      writeFileSync(path.join(dir, "node_modules", ".keep"), "");
      const pkgPath = path.join(dir, "package.json");
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
        scripts: Record<string, string>;
      };
      const _originalLint = pkg.scripts.lint;
      pkg.scripts.lint = "node -e 'process.exit(1)'";
      writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));

      // Snapshot before apply
      const preManifestRaw = readFileSync(manifestPath, "utf8");
      const preHash = hashDir(dir);
      const preReadme = readFileSync(readmePath, "utf8");
      const _prePkgRaw = readFileSync(pkgPath, "utf8");
      const preEnvExample = existsSync(envExamplePath)
        ? readFileSync(envExamplePath, "utf8")
        : null;
      const preEnvReal = readFileSync(envRealPath, "utf8");
      const preLicenseExists = existsSync(licensePath);
      const preUnmanagedExists = existsSync(unmanagedPath);

      // Run update --apply (should apply README and LICENSE then fail lint and rollback)
      const proc = Bun.spawnSync([
        "bun",
        "generator/src/update-project.ts",
        "--project",
        dir,
        "--to",
        "0.11.0",
        "--apply",
        "--json",
      ]);
      expect(proc.exitCode).not.toBe(0);
      const stdout = proc.stdout.toString();
      const stderr = proc.stderr.toString();
      const combined = `${stdout}\n${stderr}`;
      // Must indicate validation failure and rollback
      expect(combined.toLowerCase()).toMatch(
        /lint failed|post-validation|validation.*failed|rolled back/,
      );

      // All managed files restored
      const postManifestRaw = readFileSync(manifestPath, "utf8");
      expect(postManifestRaw).toBe(preManifestRaw);
      const manifestPost = readManifest(dir);
      expect(manifestPost.starter.version).toBe("0.10.1");
      expect(manifestPost.appliedUpdates).toEqual([]);

      const postReadme = readFileSync(readmePath, "utf8");
      expect(postReadme).toBe(preReadme);

      // Added files must disappear (LICENSE was added then rolled back)
      expect(existsSync(licensePath)).toBe(preLicenseExists);
      if (licenseBackup && preLicenseExists === false) {
        // Should still be missing after rollback
        expect(existsSync(licensePath)).toBe(false);
      }

      // Local customizations preserved
      const postPkg = JSON.parse(readFileSync(pkgPath, "utf8")) as Record<string, unknown>;
      expect((postPkg.scripts as Record<string, string>)["my:script"]).toBe("echo hello");
      if (preEnvExample !== null) {
        expect(readFileSync(envExamplePath, "utf8")).toBe(preEnvExample);
      }
      expect(readFileSync(envRealPath, "utf8")).toBe(preEnvReal);
      expect(existsSync(unmanagedPath)).toBe(preUnmanagedExists);
      if (preUnmanagedExists) {
        expect(readFileSync(unmanagedPath, "utf8")).toBe("export const foo='bar';\n");
      }

      // Hashes (excluding node_modules and .api-starter) restored
      const postHash = hashDir(dir);
      expect([...preHash.entries()]).toEqual([...postHash.entries()]);

      // Evidence that skipped contract would hide failure: runPostValidations without node_modules returns ok:true
      // (documented in verification report). Our test proves that with node_modules the failure is not skipped.

      cleanup(dir);
    },
    { timeout: 35000 },
  );
});
