import { copyFileSync, readFileSync, writeFileSync } from "node:fs";

import { GenerationError } from "./errors";
import type { FileStrategy } from "./manifest";

export function getFileStrategy(relativePath: string): FileStrategy {
  if (
    relativePath === "package.json" ||
    relativePath === "apps/api/package.json" ||
    relativePath === "tsconfig.json" ||
    relativePath === ".env.example" ||
    relativePath === "drizzle.config.ts" ||
    relativePath === "docker-compose.yml" ||
    relativePath === "packages/config/src/env.ts"
  ) {
    return "structured";
  }
  if (relativePath.startsWith("scripts/db")) {
    return "scaffold";
  }
  if (relativePath === "GENERATED.md" || relativePath.startsWith(".api-starter")) {
    return "ignored";
  }
  if (relativePath.startsWith("apps/api/src/generated/")) {
    return "managed";
  }
  return "managed";
}

export function isStructuredFile(relativePath: string): boolean {
  return getFileStrategy(relativePath) === "structured";
}

// Conservative JSON merge: only update managed keys, preserve others
export function mergePackageJson(
  currentContent: string,
  nextContent: string,
  managedKeys: Set<string> = new Set(["dependencies", "devDependencies"]),
): string {
  let current: Record<string, unknown>;
  let next: Record<string, unknown>;
  try {
    current = JSON.parse(currentContent) as Record<string, unknown>;
  } catch (error) {
    throw new GenerationError(
      `invalid JSON in current package.json: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  try {
    next = JSON.parse(nextContent) as Record<string, unknown>;
  } catch (error) {
    throw new GenerationError(
      `invalid JSON in canonical package.json: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const result: Record<string, unknown> = { ...current };

  for (const key of managedKeys) {
    if (key in next) {
      // For dependencies, merge only @consulting/* and drizzle-* keys, preserve others
      if (
        (key === "dependencies" || key === "devDependencies") &&
        typeof current[key] === "object" &&
        typeof next[key] === "object"
      ) {
        const currentDeps = current[key] as Record<string, string>;
        const nextDeps = next[key] as Record<string, string>;
        const merged: Record<string, string> = { ...currentDeps };
        for (const [dep, version] of Object.entries(nextDeps)) {
          if (dep.startsWith("@consulting/") || dep === "drizzle-orm" || dep === "drizzle-kit") {
            merged[dep] = version;
          }
        }
        // Remove deps that are no longer in next but were managed
        for (const dep of Object.keys(currentDeps)) {
          if (
            (dep.startsWith("@consulting/") || dep === "drizzle-orm" || dep === "drizzle-kit") &&
            !(dep in nextDeps)
          ) {
            delete merged[dep];
          }
        }
        result[key] = merged;
      } else {
        result[key] = next[key];
      }
    }
  }
  return `${JSON.stringify(result, null, 2)}\n`;
}

// Env key-wise merge
export function mergeEnvExample(currentContent: string, nextContent: string): string {
  const parseEnv = (content: string): Map<string, string> => {
    const map = new Map<string, string>();
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (trimmed === "" || trimmed.startsWith("#")) {
        continue;
      }
      const eq = trimmed.indexOf("=");
      if (eq === -1) {
        continue;
      }
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      map.set(key, value);
    }
    return map;
  };

  const current = parseEnv(currentContent);
  const next = parseEnv(nextContent);

  // Add new keys from next that are not in current
  for (const [key, value] of next) {
    if (!current.has(key)) {
      current.set(key, value);
    }
  }

  // Build result preserving current order plus new keys
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const line of currentContent.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      lines.push(line);
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq === -1) {
      lines.push(line);
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    seen.add(key);
    // Keep current line as is
    lines.push(line);
  }
  // Append new keys not seen
  for (const [key, value] of next) {
    if (!seen.has(key)) {
      lines.push(`${key}=${value}`);
    }
  }
  return lines.join("\n");
}

export interface ApplyFileOperationOptions {
  operation: { path: string; strategy: string; classification: string };
  projectPath: string;
  canonicalPath: string;
}

export function applyFileOperation(options: ApplyFileOperationOptions): void {
  const { operation, projectPath, canonicalPath } = options;
  if (operation.strategy === "structured") {
    const rel = operation.path;
    if (rel === "package.json" || rel === "apps/api/package.json") {
      const current = readFileSync(projectPath, "utf8");
      const next = readFileSync(canonicalPath, "utf8");
      const merged = mergePackageJson(current, next);
      writeFileSync(projectPath, merged, "utf8");
      return;
    }
    if (rel === ".env.example") {
      const current = readFileSync(projectPath, "utf8");
      const next = readFileSync(canonicalPath, "utf8");
      const merged = mergeEnvExample(current, next);
      writeFileSync(projectPath, merged, "utf8");
      return;
    }
    // Unsupported structured file – fail closed; caller should have classified as conflict
    throw new GenerationError(`unsupported structured file ${rel}: no safe merger`);
  }
  // managed/scaffold/generated-region: direct copy
  copyFileSync(canonicalPath, projectPath);
}
