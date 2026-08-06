import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { resolveUpdatePath } from "../updates/registry";
import { applyFileOperation } from "./file-strategies";
import { hashFileContent } from "./hashing";
import { readManifest, writeManifest } from "./manifest";
import { cleanupTempDir, materializeToTemp } from "./materialize";
import { planFeatureSet } from "./plan";
import { resolveTargetVersion } from "./starter-version";
import { buildUpdatePlan } from "./update-plan";
import { runPostValidations } from "./validate-post";

const USAGE = `usage: bun generator/src/update-project.ts --project <dir> [--to <version>] [--apply] [--json]`;

function parseArgs(args: readonly string[]): {
  project: string;
  to: string | undefined;
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
  return { project: path.resolve(project), to, apply, asJson };
}

function main(): void {
  const { project, to: userTo, apply, asJson } = parseArgs(process.argv.slice(2));

  let canonical: string;
  try {
    canonical = resolveTargetVersion(userTo);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const toForOutput = userTo ?? "(none)";
    if (asJson) {
      console.log(JSON.stringify({ project, to: toForOutput, valid: false, error: msg }, null, 2));
    } else {
      console.error(`error: ${msg}`);
    }
    process.exit(1);
  }
  const to = canonical;

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

  // Resolve registry path early to fail before materializing if possible
  let updatePath: ReturnType<typeof resolveUpdatePath> = [];
  let pathError: string | null = null;
  try {
    updatePath = resolveUpdatePath(manifest.starter.version, canonical);
  } catch (error) {
    pathError = error instanceof Error ? error.message : String(error);
  }

  let canonicalDir: string | null = null;
  try {
    const plan = planFeatureSet(manifest.generation.features, manifest.generation.profile);
    canonicalDir = materializeToTemp(plan);
    const updatePlan = buildUpdatePlan(project, manifest, canonicalDir);

    const conflicts = updatePlan.files.filter((f) => f.classification === "conflict");
    const manualMigrations = updatePlan.files.filter(
      (f) => f.classification === "manual-migration",
    );
    const safeOps = updatePlan.files.filter((f) =>
      ["add", "update-safe", "remove-safe"].includes(f.classification),
    );
    const requiresManual = updatePath.some((u) => (u.requiresManual?.length ?? 0) > 0);
    const hasPathError = pathError !== null;
    const blocking =
      conflicts.length > 0 || manualMigrations.length > 0 || requiresManual || hasPathError;

    if (asJson) {
      const output: Record<string, unknown> = {
        project,
        to,
        fromVersion: manifest.starter.version,
        toVersion: canonical,
        apply,
        valid: !blocking && safeOps.length >= 0,
        files: updatePlan.files.map((f) => ({
          path: f.path,
          classification: f.classification,
          reason: f.reason,
          strategy: f.strategy,
        })),
        updatePath: updatePath.map((u) => ({
          id: u.id,
          from: u.from,
          to: u.to,
          breakingNotes: u.breakingNotes,
          requiresManual: u.requiresManual,
          postValidations: u.postValidations,
        })),
      };
      if (pathError) (output as Record<string, unknown>).error = pathError;
      if (requiresManual)
        (output as Record<string, unknown>).requiresManual = updatePath.flatMap(
          (u) => u.requiresManual ?? [],
        );
      if (manualMigrations.length > 0)
        (output as Record<string, unknown>).manualMigrations = manualMigrations.map((f) => f.path);
      console.log(JSON.stringify(output, null, 2));
      if (!apply) {
        process.exit(blocking ? 1 : 0);
      }
    } else {
      if (!apply) {
        console.log(`update (dry-run): ${project} (${manifest.starter.version} → ${canonical})`);
        if (pathError) console.log(`update path error: ${pathError}`);
        if (updatePath.length > 0) {
          console.log(`update path: ${updatePath.map((u) => u.id).join(" -> ")}`);
          for (const u of updatePath) {
            if (u.breakingNotes) console.log(`  breaking: ${u.id}: ${u.breakingNotes}`);
            if (u.requiresManual?.length)
              console.log(`  manual: ${u.id}: ${u.requiresManual.join(", ")}`);
            if (u.postValidations?.length)
              console.log(`  validations: ${u.id}: ${u.postValidations.join(", ")}`);
          }
        }
        console.log(
          `safe operations: ${safeOps.length}, conflicts: ${conflicts.length}, manual-migrations: ${manualMigrations.length}`,
        );
        for (const file of updatePlan.files) {
          if (
            ["add", "update-safe", "remove-safe", "conflict", "manual-migration"].includes(
              file.classification,
            )
          ) {
            console.log(
              `  ${file.classification}: ${file.path} — ${file.reason} [${file.strategy}]`,
            );
          }
        }
        if (blocking) {
          if (pathError) console.log(`\nupdate path error: ${pathError}`);
          if (requiresManual) console.log("\nmanual steps required: not applying");
          if (manualMigrations.length > 0)
            console.log("\nmanual migrations detected: not applying");
          if (conflicts.length > 0)
            console.log("\nconflicts detected: not applying without resolution");
        } else if (safeOps.length === 0) {
          console.log("\nno changes to apply");
        }
      }
    }

    if (!apply) {
      process.exit(blocking ? 1 : 0);
    }

    // --apply path
    if (blocking) {
      if (!asJson) {
        if (pathError) console.error(`error: update path error: ${pathError}`);
        if (requiresManual) {
          console.error(`error: manual steps required:`);
          for (const u of updatePath)
            if (u.requiresManual?.length)
              console.error(`  ${u.id}: ${u.requiresManual.join(", ")}`);
        }
        if (manualMigrations.length > 0) {
          console.error(`error: manual-migration files detected:`);
          for (const m of manualMigrations) console.error(`  ${m.path} — ${m.reason}`);
        }
        if (conflicts.length > 0) {
          console.error(`error: ${conflicts.length} conflict(s) detected; not applying`);
          for (const c of conflicts) console.error(`  conflict: ${c.path} — ${c.reason}`);
        }
      }
      process.exit(1);
    }

    if (safeOps.length === 0) {
      if (!asJson) {
        console.log("no changes to apply; already up to date");
      }
      // Idempotent: no manifest bump, no writes
      // But if updatePath empty and from!==to, that case already blocked by pathError/downgrade
      // If from===to, we are idempotent
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
          backedUp.push({ path: op.path, backupPath: null, wasNew: true });
          mkdirSync(path.dirname(projectPath), { recursive: true });
          // For add, use dispatcher if structured? But add with structured not possible (should be conflict). So copy.
          if (op.strategy === "structured") {
            // Still need to copy but via dispatcher would fail because project file doesn't exist yet.
            // For add, just copy canonical
            copyFileSync(canonicalPath, projectPath);
          } else {
            copyFileSync(canonicalPath, projectPath);
          }
          if (!asJson) console.log(`  add: ${op.path}`);
        } else if (op.classification === "update-safe") {
          const backupPath = path.join(backupDir, op.path);
          mkdirSync(path.dirname(backupPath), { recursive: true });
          if (existsSync(projectPath)) {
            copyFileSync(projectPath, backupPath);
          }
          backedUp.push({ path: op.path, backupPath, wasNew: false });
          if (op.strategy === "structured") {
            applyFileOperation({ operation: op, projectPath, canonicalPath });
          } else {
            copyFileSync(canonicalPath, projectPath);
          }
          if (!asJson) console.log(`  update: ${op.path}`);
        } else if (op.classification === "remove-safe") {
          const backupPath = path.join(backupDir, op.path);
          mkdirSync(path.dirname(backupPath), { recursive: true });
          if (existsSync(projectPath)) {
            copyFileSync(projectPath, backupPath);
            backedUp.push({ path: op.path, backupPath, wasNew: false });
            rmSync(projectPath, { force: true });
            if (!asJson) console.log(`  remove: ${op.path}`);
          }
        }
      }

      // Post-validations: union registry postValidations + base
      const extraValidations = updatePath.flatMap((u) => u.postValidations ?? []);
      const validation = runPostValidations(project, extraValidations);
      if (!validation.ok) {
        throw new Error(validation.error ?? `post-validation ${validation.failedId} failed`);
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
              const strategy = existing?.strategy ?? (op.strategy as string);
              newManagedFiles[op.path] = { baselineHash, strategy };
            } catch {
              // ignore
            }
          }
        }
      }
      const ids = updatePath.map((u) => u.id);
      const nextApplied = [...new Set([...manifest.appliedUpdates, ...ids])];
      const updatedManifest = {
        ...manifest,
        starter: { ...manifest.starter, version: canonical },
        generation: { ...manifest.generation, updatedAt: new Date().toISOString() },
        managedFiles: Object.fromEntries(
          Object.entries(newManagedFiles).sort(([a], [b]) => a.localeCompare(b)),
        ),
        appliedUpdates: nextApplied,
      };
      writeManifest(project, updatedManifest as never);

      if (!asJson) {
        console.log(
          `\nupdate applied: ${safeOps.length} file(s) updated, manifest bumped to ${canonical}`,
        );
        console.log(`backup at: ${backupDir}`);
        if (ids.length > 0) console.log(`applied updates: ${ids.join(", ")}`);
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
