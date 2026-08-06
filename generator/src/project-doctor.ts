import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";

import { hashFileContent } from "./hashing";
import { readManifest } from "./manifest";
import { validateFeatureSet } from "./validate";
import { planFeatureSet } from "./plan";
import { computeRemoveList } from "./prune";

export interface DoctorIssue {
  code: string;
  path?: string;
  severity: "error" | "warning" | "info";
  message: string;
  suggestion?: string;
}

export interface DoctorResult {
  project: string;
  issues: DoctorIssue[];
  valid: boolean;
}

function isGitDirty(projectDir: string): boolean {
  try {
    const output = execSync("git status --porcelain", { cwd: projectDir, encoding: "utf8", stdio: "pipe" });
    return output.trim().length > 0;
  } catch {
    return false;
  }
}

export function doctorProject(projectDir: string): DoctorResult {
  const issues: DoctorIssue[] = [];
  const manifestPath = path.join(projectDir, ".api-starter", "manifest.json");

  if (!existsSync(manifestPath)) {
    const generatedPath = path.join(projectDir, "GENERATED.md");
    if (existsSync(generatedPath)) {
      issues.push({
        code: "manifest-missing-legacy",
        severity: "error",
        message: "manifest missing but legacy GENERATED.md found; run generator:adopt",
        suggestion: `bun run generator:adopt -- --project=${projectDir} --baseline=<version>`,
      });
    } else {
      issues.push({
        code: "manifest-missing",
        severity: "error",
        message: `manifest not found at ${manifestPath}`,
        suggestion: "regenerate the project or run generator:adopt for legacy projects",
      });
    }
    // Still check git dirty as warning
    if (isGitDirty(projectDir)) {
      issues.push({
        code: "git-dirty",
        severity: "warning",
        message: "git working tree is dirty",
        suggestion: "commit or stash changes before running doctor",
      });
    }
    return { project: projectDir, issues, valid: issues.filter((i) => i.severity === "error").length === 0 };
  }

  let manifest: ReturnType<typeof readManifest>;
  try {
    manifest = readManifest(projectDir);
  } catch (error) {
    issues.push({
      code: "manifest-invalid",
      severity: "error",
      message: `manifest is invalid: ${error instanceof Error ? error.message : String(error)}`,
      suggestion: "check .api-starter/manifest.json for corruption, or regenerate",
    });
    if (isGitDirty(projectDir)) {
      issues.push({
        code: "git-dirty",
        severity: "warning",
        message: "git working tree is dirty",
      });
    }
    return { project: projectDir, issues, valid: false };
  }

  // Schema check already done in readManifest, but check version
  if (manifest.schemaVersion !== 1) {
    issues.push({
      code: "schema-unsupported",
      severity: "error",
      message: `unsupported schemaVersion ${manifest.schemaVersion}`,
    });
  }

  // Features validity
  const featureIssues = validateFeatureSet(manifest.generation.features);
  if (featureIssues.length > 0) {
    for (const issue of featureIssues) {
      issues.push({
        code: "feature-invalid",
        severity: "error",
        message: issue.message,
      });
    }
  }

  // Check managed files existence and hash
  for (const [rel, entry] of Object.entries(manifest.managedFiles)) {
    const fullPath = path.join(projectDir, rel);
    if (!existsSync(fullPath)) {
      issues.push({
        code: "managed-missing",
        severity: "error",
        path: rel,
        message: `managed file missing: ${rel}`,
        suggestion: "run generator:diff to see expected vs actual",
      });
      continue;
    }
    try {
      const content = readFileSync(fullPath, "utf8");
      const currentHash = hashFileContent(content);
      if (currentHash !== entry.baselineHash) {
        issues.push({
          code: "managed-modified",
          severity: "error",
          path: rel,
          message: `managed file modified: ${rel} (baseline ${entry.baselineHash.slice(0, 12)}… vs current ${currentHash.slice(0, 12)}…)`,
          suggestion: "customized file will be treated as conflict on update",
        });
      }
    } catch {
      issues.push({
        code: "managed-unreadable",
        severity: "error",
        path: rel,
        message: `managed file unreadable: ${rel}`,
      });
    }
  }

  // Check for residual files from disabled features (prune list present)
  try {
    const plan = planFeatureSet(manifest.generation.features, manifest.generation.profile);
    const removeList = computeRemoveList(plan);
    for (const rel of removeList) {
      const fullPath = path.join(projectDir, rel);
      if (existsSync(fullPath)) {
        issues.push({
          code: "residual-file",
          severity: "error",
          path: rel,
          message: `residual file from disabled feature: ${rel} should not exist`,
          suggestion: "remove the file or check feature selection",
        });
      }
    }
  } catch {
    // ignore plan errors
  }

  // Check for extra untracked files (info, not error)
  // For now, we just note them as info if they exist but are not in managedFiles and not in removeList
  // Not considered error per spec

  // Git dirty as warning
  if (isGitDirty(projectDir)) {
    issues.push({
      code: "git-dirty",
      severity: "warning",
      message: "git working tree is dirty",
      suggestion: "commit or stash before update",
    });
  }

  const valid = issues.filter((i) => i.severity === "error").length === 0;
  return { project: projectDir, issues, valid };
}

function printHuman(result: DoctorResult): void {
  if (result.issues.length === 0) {
    console.log(`doctor: ${result.project} — ok (no issues)`);
    return;
  }
  for (const issue of result.issues) {
    const prefix = issue.severity === "error" ? "error" : issue.severity === "warning" ? "warning" : "info";
    const loc = issue.path ? ` ${issue.path}` : "";
    console.log(`${prefix} [${issue.code}]${loc}: ${issue.message}`);
    if (issue.suggestion) {
      console.log(`  suggestion: ${issue.suggestion}`);
    }
  }
  const errors = result.issues.filter((i) => i.severity === "error").length;
  const warnings = result.issues.filter((i) => i.severity === "warning").length;
  console.log(`\ndoctor: ${errors} error(s), ${warnings} warning(s)`);
}

function main(): void {
  const args = process.argv.slice(2);
  let projectDir = ".";
  let asJson = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--project" || arg.startsWith("--project=")) {
      projectDir = arg === "--project" ? (args[++i] as string) : arg.slice("--project=".length);
    } else if (arg === "--json") {
      asJson = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log("usage: bun generator/src/project-doctor.ts --project <dir> [--json]");
      process.exit(0);
    }
  }
  const result = doctorProject(path.resolve(projectDir));
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printHuman(result);
  }
  process.exit(result.valid ? 0 : 1);
}

if (import.meta.main) {
  main();
}
