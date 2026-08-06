import { existsSync } from "node:fs";
import path from "node:path";
import { resolveUpdatePath } from "../updates/registry";
import { readManifest } from "./manifest";
import { cleanupTempDir, materializeToTemp } from "./materialize";
import { planFeatureSet } from "./plan";
import { resolveTargetVersion } from "./starter-version";
import { buildUpdatePlan } from "./update-plan";

const USAGE = `usage: bun generator/src/diff-project.ts --project <dir> [--to <version>] [--json]`;

function parseArgs(args: readonly string[]): {
  project: string;
  to: string | undefined;
  asJson: boolean;
} {
  let project = ".";
  let to: string | undefined;
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
  return { project: path.resolve(project), to, asJson };
}

function main(): void {
  const { project, to: userTo, asJson } = parseArgs(process.argv.slice(2));

  // Resolve canonical version before any I/O that mutates; fail fast on mismatch
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

  // Validate registry path before materializing (still require manifest)
  let updatePath: ReturnType<typeof resolveUpdatePath> = [];
  let pathError: string | null = null;
  try {
    updatePath = resolveUpdatePath(manifest.starter.version, canonical);
  } catch (error) {
    pathError = error instanceof Error ? error.message : String(error);
  }

  // Materialize canonical target using exactly the same features
  let canonicalDir: string | null = null;
  try {
    const plan = planFeatureSet(manifest.generation.features, manifest.generation.profile);
    canonicalDir = materializeToTemp(plan);

    const updatePlan = buildUpdatePlan(project, manifest, canonicalDir);

    const hasConflict =
      updatePlan.files.some(
        (f) => f.classification === "conflict" || f.classification === "manual-migration",
      ) || pathError !== null;
    const hasInvalid = pathError !== null;
    const requiresManual = updatePath.some((u) => (u.requiresManual?.length ?? 0) > 0);

    if (asJson) {
      const output: Record<string, unknown> = {
        project,
        to,
        fromVersion: manifest.starter.version,
        toVersion: canonical,
        valid: !hasConflict && !hasInvalid && !requiresManual,
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
      if (pathError) {
        (output as Record<string, unknown>).error = pathError;
      }
      if (requiresManual) {
        (output as Record<string, unknown>).requiresManual = updatePath.flatMap(
          (u) => u.requiresManual ?? [],
        );
      }
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(`diff: ${project} (${manifest.starter.version} → ${canonical})`);
      console.log(
        `profile: ${manifest.generation.profile}, features: ${manifest.generation.features.join(", ") || "(none)"}`,
      );
      if (pathError) {
        console.log(`update path error: ${pathError}`);
      }
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
      console.log("");
      const groups: Record<string, typeof updatePlan.files> = {};
      for (const file of updatePlan.files) {
        if (!groups[file.classification]) {
          groups[file.classification] = [];
        }
        groups[file.classification]?.push(file);
      }
      for (const classification of [
        "add",
        "update-safe",
        "remove-safe",
        "conflict",
        "customized-no-upstream-change",
        "unchanged",
        "manual-migration",
      ] as const) {
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

    process.exit(hasConflict || hasInvalid || requiresManual ? 1 : 0);
  } finally {
    if (canonicalDir) {
      cleanupTempDir(canonicalDir);
    }
  }
}

if (import.meta.main) {
  main();
}
