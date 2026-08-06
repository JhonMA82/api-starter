import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";

import { hashFileContent } from "./hashing";
import { readManifest, writeManifest } from "./manifest";
import { cleanupTempDir, materializeToTemp } from "./materialize";
import { planFeatureSet } from "./plan";
import { buildUpdatePlan } from "./update-plan";

const USAGE = `usage: bun generator/src/update-project.ts --project <dir> --to <version> [--apply] [--json]`;

function parseArgs(args: readonly string[]): {
  project: string;
  to: string;
  apply: boolean;
  asJson: boolean;
} {
  let project = ".";
  let to: string | undefined;
  let apply = false;
  let asJson = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === undefined) {
      continue;
    }
    if (arg === "--project" || arg.startsWith("--project=")) {
      project = arg === "--project" ? (args[++i] as string) : arg.slice("--project=".length);
    } else if (arg === "--to" || arg.startsWith("--to=")) {
      to = arg === "--to" ? (args[++i] as string) : arg.slice("--to=".length);
    } else if (arg === "--apply") {
      apply = true;
    } else if (arg === "--json") {
      asJson = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log(USAGE);
      process.exit(0);
    } else {
      console.error(`unknown argument "${arg}"\n${USAGE}`);
      process.exit(2);
    }
  }
  if (!to) {
    console.error(`--to is required\n${USAGE}`);
    process.exit(2);
  }
  return { project: path.resolve(project), to, apply, asJson };
}

function runPostValidations(projectDir: string): { ok: boolean; error?: string } {
  try {
    execSync("bun x tsc --noEmit", { cwd: projectDir, stdio: "pipe", timeout: 30_000 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `typecheck failed: ${msg}` };
  }
  // Optionally run tests if they exist and are quick; for now, just typecheck
  return { ok: true };
}

function main(): void {
  const { project, to, apply, asJson } = parseArgs(process.argv.slice(2));

  let manifest: ReturnType<typeof readManifest>;
  try {
    manifest = readManifest(project);
  } catch (error) {
    const msg = `manifest invalid: ${error instanceof Error ? error.message : String(error)}`;
    if (asJson) {
      console.log(JSON.stringify({ project, to, valid: false, error: msg }, null, 2));
    } else {
      console.error(`error: ${msg}`);
    }
    process.exit(1);
  }

  let canonicalDir: string | null = null;
  try {
    const plan = planFeatureSet(manifest.generation.features, manifest.generation.profile);
    canonicalDir = materializeToTemp(plan);
    const updatePlan = buildUpdatePlan(project, manifest, canonicalDir);

    const conflicts = updatePlan.files.filter((f) => f.classification === "conflict");
    const safeOps = updatePlan.files.filter((f) =>
      ["add", "update-safe", "remove-safe"].includes(f.classification),
    );

    if (asJson) {
      const output = {
        project,
        to,
        fromVersion: manifest.starter.version,
        toVersion: to,
        apply,
        valid: conflicts.length === 0,
        files: updatePlan.files.map((f) => ({
          path: f.path,
          classification: f.classification,
          reason: f.reason,
          strategy: f.strategy,
        })),
      };
      console.log(JSON.stringify(output, null, 2));
      if (!apply) {
        process.exit(conflicts.length > 0 ? 1 : 0);
      }
      if (conflicts.length > 0 && apply) {
        // Still exit 1 if conflicts and apply, but we already printed json
        // The actual apply will be blocked below
      }
    } else {
      if (!apply) {
        console.log(`update (dry-run): ${project} (${manifest.starter.version} → ${to})`);
        console.log(`safe operations: ${safeOps.length}, conflicts: ${conflicts.length}`);
        for (const file of updatePlan.files) {
          if (["add", "update-safe", "remove-safe", "conflict"].includes(file.classification)) {
            console.log(`  ${file.classification}: ${file.path} — ${file.reason}`);
          }
        }
        if (conflicts.length > 0) {
          console.log("\nconflicts detected: not applying without resolution");
        } else if (safeOps.length === 0) {
          console.log("\nno changes to apply");
        }
      }
    }

    if (!apply) {
      process.exit(conflicts.length > 0 ? 1 : 0);
    }

    // --apply path
    if (conflicts.length > 0) {
      if (!asJson) {
        console.error(`error: ${conflicts.length} conflict(s) detected; not applying`);
        for (const c of conflicts) {
          console.error(`  conflict: ${c.path} — ${c.reason}`);
        }
      }
      process.exit(1);
    }

    if (safeOps.length === 0) {
      if (!asJson) {
        console.log("no changes to apply; already up to date");
      }
      // Still update manifest's updatedAt? No, idempotent second run should do no writes
      process.exit(0);
    }

    // Backup
    const backupDir = path.join(
      project,
      ".api-starter",
      "backups",
      new Date().toISOString().replace(/[:.]/g, "-"),
    );
    mkdirSync(backupDir, { recursive: true });
    const backedUp: { path: string; backupPath: string | null; wasNew: boolean }[] = [];

    try {
      for (const op of safeOps.sort((a, b) => a.path.localeCompare(b.path))) {
        const projectPath = path.join(project, op.path);
        const canonicalPath = path.join(canonicalDir, op.path);

        if (op.classification === "add") {
          // Backup not needed for add (was not existing), but record for rollback (delete on rollback)
          backedUp.push({ path: op.path, backupPath: null, wasNew: true });
          mkdirSync(path.dirname(projectPath), { recursive: true });
          copyFileSync(canonicalPath, projectPath);
          if (!asJson) {
            console.log(`  add: ${op.path}`);
          }
        } else if (op.classification === "update-safe") {
          const backupPath = path.join(backupDir, op.path);
          mkdirSync(path.dirname(backupPath), { recursive: true });
          if (existsSync(projectPath)) {
            copyFileSync(projectPath, backupPath);
          }
          backedUp.push({ path: op.path, backupPath, wasNew: false });
          // For structured files, we should do a merge, but for now just copy
          // TODO: use file-strategies merge for package.json etc.
          copyFileSync(canonicalPath, projectPath);
          if (!asJson) {
            console.log(`  update: ${op.path}`);
          }
        } else if (op.classification === "remove-safe") {
          const backupPath = path.join(backupDir, op.path);
          mkdirSync(path.dirname(backupPath), { recursive: true });
          if (existsSync(projectPath)) {
            copyFileSync(projectPath, backupPath);
            backedUp.push({ path: op.path, backupPath, wasNew: false });
            rmSync(projectPath, { force: true });
            if (!asJson) {
              console.log(`  remove: ${op.path}`);
            }
          }
        }
      }

      // Post-validations
      const validation = runPostValidations(project);
      if (!validation.ok) {
        throw new Error(validation.error ?? "post-validation failed");
      }

      // Update manifest at the end, never at the beginning
      const newManagedFiles: Record<string, { baselineHash: string; strategy: string }> = {
        ...manifest.managedFiles,
      };
      for (const op of safeOps) {
        if (op.classification === "remove-safe") {
          delete newManagedFiles[op.path];
        } else {
          const projectPath = path.join(project, op.path);
          if (existsSync(projectPath) && !statSync(projectPath).isDirectory()) {
            try {
              const content = readFileSync(projectPath, "utf8");
              const baselineHash = hashFileContent(content);
              const existing = manifest.managedFiles[op.path];
              const strategy = existing?.strategy ?? "managed";
              newManagedFiles[op.path] = { baselineHash, strategy };
            } catch {
              // ignore
            }
          }
        }
      }
      const updatedManifest = {
        ...manifest,
        starter: { ...manifest.starter, version: to },
        generation: { ...manifest.generation, updatedAt: new Date().toISOString() },
        managedFiles: Object.fromEntries(
          Object.entries(newManagedFiles).sort(([a], [b]) => a.localeCompare(b)),
        ),
        appliedUpdates: [...manifest.appliedUpdates, `${manifest.starter.version}->${to}`],
      };
      writeManifest(project, updatedManifest as never);

      if (!asJson) {
        console.log(
          `\nupdate applied: ${safeOps.length} file(s) updated, manifest bumped to ${to}`,
        );
        console.log(`backup at: ${backupDir}`);
      }
      process.exit(0);
    } catch (error) {
      // Rollback
      for (const entry of backedUp) {
        const projectPath = path.join(project, entry.path);
        if (entry.wasNew) {
          if (existsSync(projectPath)) {
            rmSync(projectPath, { force: true });
          }
        } else if (entry.backupPath && existsSync(entry.backupPath)) {
          mkdirSync(path.dirname(projectPath), { recursive: true });
          copyFileSync(entry.backupPath, projectPath);
        }
      }
      const msg = `update failed and was rolled back: ${error instanceof Error ? error.message : String(error)}`;
      if (asJson) {
        console.log(JSON.stringify({ project, to, valid: false, error: msg }, null, 2));
      } else {
        console.error(`error: ${msg}`);
      }
      process.exit(1);
    }
  } finally {
    if (canonicalDir) {
      cleanupTempDir(canonicalDir);
    }
  }
}

if (import.meta.main) {
  main();
}
