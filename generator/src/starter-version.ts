import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { GenerationError } from "./errors";

export function getStarterRoot(): string {
  // Primary: directory of package.json two levels up from this file (generator/src -> repo root)
  try {
    const viaImport = fileURLToPath(new URL("../../", import.meta.url));
    if (existsSync(path.join(viaImport, "package.json"))) {
      return viaImport;
    }
  } catch {
    // ignore
  }
  // Fallback: git root
  try {
    const gitRoot = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();
    if (gitRoot && existsSync(path.join(gitRoot, "package.json"))) {
      return gitRoot;
    }
  } catch {
    // ignore
  }
  // Last resort: cwd
  return process.cwd();
}

export function getCanonicalStarterVersion(): string {
  const root = getStarterRoot();
  const pkgPath = path.join(root, "package.json");
  try {
    const raw = readFileSync(pkgPath, "utf8");
    const pkg = JSON.parse(raw) as { version?: string; name?: string };
    if (pkg.version && typeof pkg.version === "string" && pkg.version.length > 0) {
      return pkg.version;
    }
  } catch (error) {
    throw new GenerationError(
      `cannot determine starter version from ${pkgPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  throw new GenerationError(`starter version missing in ${pkgPath}`);
}

export function resolveTargetVersion(userTo?: string): string {
  const canonical = getCanonicalStarterVersion();
  if (!userTo) {
    return canonical;
  }
  if (userTo !== canonical) {
    throw new GenerationError(`version mismatch: --to ${userTo} != canonical ${canonical}`);
  }
  return canonical;
}

export function assertCanonicalMatchesRegistry(registryVersion: string): void {
  const canonical = getCanonicalStarterVersion();
  if (registryVersion !== canonical) {
    throw new GenerationError(
      `version drift: registry STARTER_VERSION ${registryVersion} != package.json ${canonical}`,
    );
  }
}
