import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { readGeneratedManifest } from "./add-feature";
import { GenerationError } from "./errors";
import { getFileStrategy } from "./file-strategies";
import { hashFileContent } from "./hashing";
import { createManifest, type ManifestFileEntry, writeManifest } from "./manifest";
import { cleanupTempDir, materializeToTemp } from "./materialize";
import { planFeatureSet } from "./plan";
import { getCanonicalStarterVersion } from "./starter-version";
import { validateFeatureSet } from "./validate";

const USAGE = `usage: bun generator/src/adopt-project.ts --project <dir> --baseline <version>`;

interface AdoptOptions {
  project: string;
  baseline: string;
}

function parseArgs(args: readonly string[]): AdoptOptions {
  let project: string | undefined;
  let baseline: string | undefined;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === undefined) {
      continue;
    }
    if (arg === "--project" || arg.startsWith("--project=")) {
      project = arg === "--project" ? args[++i] : arg.slice("--project=".length);
    } else if (arg === "--baseline" || arg.startsWith("--baseline=")) {
      baseline = arg === "--baseline" ? args[++i] : arg.slice("--baseline=".length);
    } else if (arg === "--help" || arg === "-h") {
      console.log(USAGE);
      process.exit(0);
    } else {
      throw new GenerationError(`unknown argument "${arg}"\n${USAGE}`);
    }
  }
  if (!project) {
    throw new GenerationError(`--project is required\n${USAGE}`);
  }
  if (!baseline) {
    throw new GenerationError(`--baseline is required; cannot guess baseline version\n${USAGE}`);
  }
  return { project, baseline };
}

function walkFiles(root: string, base = ""): string[] {
  const entries = readdirSync(root, { withFileTypes: true });
  const result: string[] = [];
  for (const entry of entries) {
    const rel = base === "" ? entry.name : `${base}/${entry.name}`;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if ([".git", "node_modules", ".api-starter"].includes(entry.name)) {
        continue;
      }
      result.push(...walkFiles(full, rel));
    } else {
      result.push(rel);
    }
  }
  return result;
}

function assertBaselineMaterializable(baseline: string): void {
  const canonical = getCanonicalStarterVersion();
  if (baseline !== canonical) {
    throw new GenerationError(
      `baseline ${baseline} is not materializable from current checkout (canonical is ${canonical}); only the current checkout version can be adopted without historical snapshots`,
    );
  }
}

export function adoptProject(options: AdoptOptions): { manifestPath: string; report: string } {
  const projectRoot = path.resolve(options.project);
  if (!existsSync(projectRoot) || !statSync(projectRoot).isDirectory()) {
    throw new GenerationError(`project directory does not exist: ${projectRoot}`);
  }
  const generatedPath = path.join(projectRoot, "GENERATED.md");
  if (!existsSync(generatedPath)) {
    throw new GenerationError(`project ${projectRoot} has no GENERATED.md; cannot adopt`);
  }
  const generatedSource = readFileSync(generatedPath, "utf8");
  const manifest = readGeneratedManifest(generatedSource);
  const { profile, features } = manifest;

  const issues = validateFeatureSet(features);
  if (issues.length > 0) {
    throw new GenerationError(
      `generated manifest feature set is invalid: ${issues.map((i) => i.message).join("; ")}`,
    );
  }

  assertBaselineMaterializable(options.baseline);

  // Materialize baseline to temp for comparison
  let baselineTemp: string | null = null;
  const reportLines: string[] = [];
  reportLines.push(`Adopting project at ${projectRoot}`);
  reportLines.push(`  baseline: ${options.baseline}`);
  reportLines.push(`  profile: ${profile}`);
  reportLines.push(`  features: ${features.join(", ") || "(none)"}`);
  reportLines.push("");

  const managedFiles: Record<string, ManifestFileEntry> = {};

  try {
    baselineTemp = materializeToTemp(planFeatureSet(features, profile));

    const baselineFiles = new Set(walkFiles(baselineTemp));
    const _projectFiles = new Set(walkFiles(projectRoot));

    const allRelevant = new Set([...baselineFiles]);

    let intact = 0;
    let customized = 0;
    let missing = 0;

    for (const rel of [...allRelevant].sort()) {
      const baselinePath = path.join(baselineTemp, rel);
      const projectPath = path.join(projectRoot, rel);
      const baselineExists = existsSync(baselinePath) && !statSync(baselinePath).isDirectory();
      const projectExists = existsSync(projectPath) && !statSync(projectPath).isDirectory();

      if (!baselineExists) {
        continue;
      }
      if (!projectExists) {
        missing += 1;
        reportLines.push(`  missing: ${rel} (expected from baseline but not found locally)`);
        continue;
      }
      const baselineContent = readFileSync(baselinePath, "utf8");
      const projectContent = readFileSync(projectPath, "utf8");
      const baselineHash = hashFileContent(baselineContent);
      const projectHash = hashFileContent(projectContent);
      const strategy = getFileStrategy(rel);

      if (baselineHash === projectHash) {
        intact += 1;
        managedFiles[rel] = { baselineHash, strategy };
      } else {
        customized += 1;
        managedFiles[rel] = { baselineHash, strategy };
        reportLines.push(`  customized: ${rel} (locally diverged from baseline)`);
      }
    }

    reportLines.push("");
    reportLines.push(`Summary: ${intact} intact, ${customized} customized, ${missing} missing`);
    if (customized > 0) {
      reportLines.push(
        `Note: ${customized} files were locally customized and are recorded as such; they will be treated as conflicts on future updates.`,
      );
    }

    // Create manifest
    const now = new Date().toISOString();
    const manifestData = createManifest(profile, features, managedFiles);
    // Override with baseline version?
    (manifestData as unknown as Record<string, unknown>).starter = {
      name: "@consulting/api-starter",
      version: options.baseline,
    };
    (manifestData.generation as unknown as Record<string, unknown>).createdAt = now;
    (manifestData.generation as unknown as Record<string, unknown>).updatedAt = now;

    writeManifest(projectRoot, manifestData);

    const report = reportLines.join("\n");
    console.log(report);
    return { manifestPath: path.join(projectRoot, ".api-starter", "manifest.json"), report };
  } finally {
    if (baselineTemp) {
      cleanupTempDir(baselineTemp);
    }
  }
}

function main(): void {
  try {
    const options = parseArgs(process.argv.slice(2));
    const result = adoptProject(options);
    console.log(`\nadopter: manifest written to ${result.manifestPath}`);
  } catch (error) {
    if (error instanceof GenerationError) {
      console.error(`error: ${error.message}`);
      process.exit(1);
    }
    throw error;
  }
}

if (import.meta.main) {
  main();
}
