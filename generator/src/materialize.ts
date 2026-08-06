import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { generateProjectFromPlan } from "./create-project";
import type { ProjectPlan } from "./plan";

export function materializeProject(plan: ProjectPlan, outDir: string): ProjectPlan {
  return generateProjectFromPlan(plan, outDir, { force: true });
}

export function materializeToTemp(plan: ProjectPlan): string {
  const tempDir = mkdtempSync(path.join(tmpdir(), "api-starter-canonical-"));
  try {
    materializeProject(plan, tempDir);
    return tempDir;
  } catch (error) {
    rmSync(tempDir, { recursive: true, force: true });
    throw error;
  }
}

export function cleanupTempDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}
