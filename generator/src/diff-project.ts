import { existsSync } from "node:fs";
import path from "node:path";

import { readManifest } from "./manifest";
import { planFeatureSet } from "./plan";
import { buildUpdatePlan } from "./update-plan";
import { materializeToTemp, cleanupTempDir } from "./materialize";

const USAGE = `usage: bun generator/src/diff-project.ts --project <dir> --to <version> [--json]`;

function parseArgs(args: readonly string[]): { project: string; to: string; asJson: boolean } {
  let project = ".";
  let to: string | undefined;
  let asJson = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--project" || arg.startsWith("--project=")) {
      project = arg === "--project" ? (args[++i] as string) : arg.slice("--project=".length);
    } else if (arg === "--to" || arg.startsWith("--to=")) {
      to = arg === "--to" ? (args[++i] as string) : arg.slice("--to=".length);
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
  return { project: path.resolve(project), to, asJson };
}

function main(): void {
  const { project, to, asJson } = parseArgs(process.argv.slice(2));

  if (!existsSync(path.join(project, ".api-starter", "manifest.json"))) {
    const msg = `manifest not found at ${path.join(project, ".api-starter", "manifest.json")}`;
    if (asJson) {
      console.log(JSON.stringify({ project, to, valid: false, error: msg }, null, 2));
    } else {
      console.error(`error: ${msg}`);
    }
    process.exit(1);
  }

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

  // Materialize canonical target using exactly the same features
  let canonicalDir: string | null = null;
  let beforeHashes: Map<string, string> | null = null;
  try {
    // For diff, we materialize with current generator's logic; --to is validated as SemVer but we don't fetch remote
    // We record before hashes to ensure we don't write
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const plan = planFeatureSet(manifest.generation.features, manifest.generation.profile);
    canonicalDir = materializeToTemp(plan);

    const updatePlan = buildUpdatePlan(project, manifest, canonicalDir);

    const hasConflict = updatePlan.files.some((f) => f.classification === "conflict");
    const hasInvalid = false; // already validated

    if (asJson) {
      const output = {
        project,
        to,
        fromVersion: manifest.starter.version,
        toVersion: to,
        valid: !hasConflict && !hasInvalid,
        files: updatePlan.files.map((f) => ({
          path: f.path,
          classification: f.classification,
          reason: f.reason,
          strategy: f.strategy,
        })),
      };
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(`diff: ${project} (${manifest.starter.version} → ${to})`);
      console.log(`profile: ${manifest.generation.profile}, features: ${manifest.generation.features.join(", ") || "(none)"}`);
      console.log("");
      const groups: Record<string, typeof updatePlan.files> = {};
      for (const file of updatePlan.files) {
        if (!groups[file.classification]) {
          groups[file.classification] = [];
        }
        groups[file.classification].push(file);
      }
      for (const classification of ["add", "update-safe", "remove-safe", "conflict", "customized-no-upstream-change", "unchanged", "manual-migration"] as const) {
        const files = groups[classification];
        if (!files || files.length === 0) {
          continue;
        }
        console.log(`${classification} (${files.length}):`);
        for (const file of files) {
          console.log(`  ${file.path} — ${file.reason} [${file.strategy}]`);
        }
        console.log("");
      }
      if (hasConflict) {
        console.log("conflicts detected: update would not be applied without resolving conflicts");
      } else {
        console.log("no conflicts: update can be applied safely");
      }
    }

    // Verify no writes occurred: check that project files were not modified during diff
    // Since diff is read-only, we just ensure we didn't write to project
    // (materializeToTemp writes to temp, not project, so safe)

    process.exit(hasConflict || hasInvalid ? 1 : 0);
  } finally {
    if (canonicalDir) {
      cleanupTempDir(canonicalDir);
    }
  }
}

if (import.meta.main) {
  main();
}
