import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { hashFileContent } from "./hashing";
import { getFileStrategy } from "./file-strategies";
import type { Manifest } from "./manifest";

export type Classification =
  | "add"
  | "update-safe"
  | "remove-safe"
  | "unchanged"
  | "customized-no-upstream-change"
  | "conflict"
  | "manual-migration";

export interface FileOperation {
  path: string;
  classification: Classification;
  reason: string;
  strategy: string;
}

export interface UpdatePlan {
  fromVersion: string;
  toVersion: string;
  files: FileOperation[];
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
      if (rel === ".api-starter/manifest.json" || rel === "bun.lock") {
        continue;
      }
      result.push(rel);
    }
  }
  return result;
}

function hashOrNull(filePath: string): string | null {
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    return null;
  }
  try {
    const content = readFileSync(filePath, "utf8");
    return hashFileContent(content);
  } catch {
    return null;
  }
}

export function buildUpdatePlan(
  projectDir: string,
  manifest: Manifest,
  canonicalDir: string,
): UpdatePlan {
  const fromVersion = manifest.starter.version;
  // toVersion will be determined by caller (e.g., from canonical's package.json or manifest)
  let toVersion = fromVersion;
  try {
    const pkgPath = path.join(canonicalDir, "package.json");
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string };
      if (pkg.version) {
        toVersion = pkg.version;
      }
    }
  } catch {
    // ignore
  }

  const baselineMap = new Map<string, string>();
  for (const [rel, entry] of Object.entries(manifest.managedFiles)) {
    baselineMap.set(rel, entry.baselineHash);
  }

  const canonicalFiles = new Set(walkFiles(canonicalDir));
  const projectFiles = new Set(walkFiles(projectDir));

  const allPaths = new Set<string>([...baselineMap.keys(), ...canonicalFiles, ...projectFiles]);

  // Filter to only paths that are managed (exclude ignored)
  const filteredPaths = [...allPaths].filter((rel) => {
    const strategy = getFileStrategy(rel);
    return strategy !== "ignored";
  });

  const operations: FileOperation[] = [];

  for (const rel of filteredPaths.sort()) {
    const baselineHash = baselineMap.get(rel) ?? null;
    const canonicalPath = path.join(canonicalDir, rel);
    const projectPath = path.join(projectDir, rel);

    const canonicalHash = hashOrNull(canonicalPath);
    const projectHash = hashOrNull(projectPath);

    const strategy = getFileStrategy(rel);
    const inBaseline = baselineHash !== null;
    const inCanonical = canonicalHash !== null;
    const inProject = projectHash !== null;

    let classification: Classification;
    let reason: string;

    if (!inBaseline && inCanonical && !inProject) {
      classification = "add";
      reason = "new file in target version and not present locally";
    } else if (!inBaseline && inCanonical && inProject) {
      // File not in baseline but exists in both - treat as unchanged if same, conflict if different
      if (projectHash === canonicalHash) {
        classification = "unchanged";
        reason = "file exists locally and matches canonical (not in baseline)";
      } else {
        classification = "conflict";
        reason = "file not in baseline but locally present and differs from canonical";
      }
    } else if (inBaseline && !inCanonical && inProject) {
      // File removed upstream
      if (projectHash === baselineHash) {
        classification = "remove-safe";
        reason = "file removed upstream and local equals baseline (not customized)";
      } else {
        classification = "conflict";
        reason = "file removed upstream but locally customized; not overwritten";
      }
    } else if (inBaseline && inCanonical && !inProject) {
      classification = "conflict";
      reason = "file expected locally (in baseline) but missing; and upstream has changes";
    } else if (inBaseline && inCanonical && inProject) {
      if (projectHash === baselineHash && canonicalHash !== baselineHash) {
        classification = "update-safe";
        reason = "local equals baseline and upstream changed; safe to update";
      } else if (projectHash === canonicalHash) {
        classification = "unchanged";
        reason = "local already equals canonical";
      } else if (projectHash !== baselineHash && canonicalHash === baselineHash) {
        classification = "customized-no-upstream-change";
        reason = "locally customized but upstream unchanged; keep customization";
      } else if (projectHash !== baselineHash && canonicalHash !== baselineHash && projectHash !== canonicalHash) {
        classification = "conflict";
        reason = "locally customized and upstream also changed; not overwritten";
      } else {
        classification = "unchanged";
        reason = "no change";
      }
    } else if (!inBaseline && !inCanonical && inProject) {
      classification = "customized-no-upstream-change";
      reason = "untracked user file; not managed";
    } else {
      classification = "unchanged";
      reason = "no change";
    }

    // Manual migration for tenancy-related files that are newly added and require data review
    // For now, we don't have a specific list, so we keep classification as is.
    // Future: if rel starts with "migrations/" and contains organization_id, mark as manual-migration

    operations.push({ path: rel, classification, reason, strategy });
  }

  // Filter to only non-unchanged and non-customized-no-upstream for reporting? But spec says to list all classifications
  // For update, we only need to act on add/update-safe/remove-safe; others are no-ops or conflicts
  return { fromVersion, toVersion, files: operations.sort((a, b) => a.path.localeCompare(b.path)) };
}

export function summarizePlan(plan: UpdatePlan): { safe: FileOperation[]; conflicts: FileOperation[]; unchanged: FileOperation[] } {
  const safe = plan.files.filter((f) => ["add", "update-safe", "remove-safe"].includes(f.classification));
  const conflicts = plan.files.filter((f) => f.classification === "conflict");
  const unchanged = plan.files.filter((f) => ["unchanged", "customized-no-upstream-change"].includes(f.classification));
  return { safe, conflicts, unchanged };
}
