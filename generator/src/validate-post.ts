import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export type ValidationId = "manifest" | "typecheck" | "lint" | "test" | "generator-smoke";

export interface ValidationResult {
  ok: boolean;
  failedId?: string;
  error?: string;
  output?: string;
}

const TIMEOUT = 30_000;

function hasScript(projectDir: string, script: string): boolean {
  try {
    const pkgPath = path.join(projectDir, "package.json");
    if (!existsSync(pkgPath)) return false;
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { scripts?: Record<string, string> };
    return typeof pkg.scripts?.[script] === "string";
  } catch {
    return false;
  }
}

function runCommand(cmd: string, cwd: string): { ok: boolean; output: string } {
  try {
    const out = execSync(cmd, { cwd, stdio: "pipe", timeout: TIMEOUT, encoding: "utf8" });
    return { ok: true, output: String(out ?? "") };
  } catch (error) {
    const err = error as { stdout?: Buffer | string; stderr?: Buffer | string; message?: string };
    const stdout = err.stdout ? String(err.stdout) : "";
    const stderr = err.stderr ? String(err.stderr) : "";
    const msg = err.message ?? String(error);
    const output = [stdout, stderr, msg].filter(Boolean).join("\n");
    return { ok: false, output };
  }
}

export function runPostValidations(projectDir: string, extraIds: string[] = []): ValidationResult {
  // If project has no node_modules, skip filesystem-dependent validations (temp projects without install)
  const hasNodeModules = existsSync(path.join(projectDir, "node_modules"));
  // Base validations that always run (if applicable and deps installed)
  const base: ValidationId[] = [];
  if (hasNodeModules) {
    base.push("typecheck");
    if (hasScript(projectDir, "lint")) base.push("lint");
    if (hasScript(projectDir, "test")) base.push("test");
  } else {
    // Minimal check: manifest validation only if requested explicitly
  }

  // Union with extraIds filtered to allow-list
  const allow: Set<string> = new Set(["manifest", "typecheck", "lint", "test", "generator-smoke"]);
  const extras = extraIds.filter((id) => allow.has(id)) as ValidationId[];
  const all = [...new Set([...base, ...extras])] as ValidationId[];

  for (const id of all) {
    // Skip heavy validations when deps not installed (temp fixtures)
    if (!hasNodeModules && id !== "manifest") {
      continue;
    }
    let result: { ok: boolean; output: string };
    switch (id) {
      case "typecheck":
        result = runCommand("bun x tsc --noEmit", projectDir);
        // Treat missing bun types without node_modules as skipped
        if (!result.ok && result.output.includes("Cannot find type definition file for 'bun'")) {
          continue;
        }
        if (!result.ok)
          return {
            ok: false,
            failedId: id,
            error: `typecheck failed: ${result.output}`,
            output: result.output,
          };
        break;
      case "lint":
        result = runCommand("bun run lint", projectDir);
        if (!result.ok)
          return {
            ok: false,
            failedId: id,
            error: `lint failed: ${result.output}`,
            output: result.output,
          };
        break;
      case "test": {
        // Prefer bun test without coverage, quick
        result = runCommand("bun test --bail", projectDir);
        if (!result.ok)
          return {
            ok: false,
            failedId: id,
            error: `test failed: ${result.output}`,
            output: result.output,
          };
        break;
      }
      case "manifest": {
        try {
          const { readManifest } = require("./manifest") as typeof import("./manifest");
          readManifest(projectDir);
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          return {
            ok: false,
            failedId: id,
            error: `manifest validation failed: ${msg}`,
            output: msg,
          };
        }
        break;
      }
      case "generator-smoke": {
        result = runCommand("bun run generator:validate", projectDir);
        if (!result.ok)
          return {
            ok: false,
            failedId: id,
            error: `generator-smoke failed: ${result.output}`,
            output: result.output,
          };
        break;
      }
      default:
        break;
    }
  }
  return { ok: true };
}
