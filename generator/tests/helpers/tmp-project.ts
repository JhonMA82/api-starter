import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { hashFileContent } from "../../src/hashing";
import { type Manifest, readManifest } from "../../src/manifest";

export function createTempProject(opts: { profile: string; features: string[] }): {
  dir: string;
  manifest: Manifest;
} {
  const dir = mkdtempSync(path.join(tmpdir(), "api-starter-test-"));
  // Use create-project CLI to materialize minimal project
  const featuresArg = opts.features.length > 0 ? `--features=${opts.features.join(",")}` : "";
  const profileArg = `--profile=${opts.profile}`;
  try {
    execSync(
      `bun generator/src/create-project.ts ${profileArg} ${featuresArg} --out=${dir} --force`,
      { stdio: "pipe" },
    );
  } catch (e) {
    rmSync(dir, { recursive: true, force: true });
    throw e;
  }
  const manifest = readManifest(dir);
  return { dir, manifest };
}

export function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

export function hashDir(dir: string): Map<string, string> {
  const map = new Map<string, string>();
  function walk(base: string, rel: string) {
    const full = path.join(base, rel);
    const entries = require("node:fs").readdirSync(full, { withFileTypes: true });
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if ([".git", "node_modules", ".api-starter"].includes(e.name)) continue;
        walk(base, r);
      } else {
        const p = path.join(base, r);
        try {
          const c = readFileSync(p, "utf8");
          map.set(r, hashFileContent(c));
        } catch {}
      }
    }
  }
  walk(dir, "");
  return map;
}

export function writePersonalization(
  dir: string,
  patch: {
    packageJson?: Record<string, unknown>;
    envExample?: string;
    files?: Record<string, string>;
  },
): void {
  if (patch.packageJson) {
    const p = path.join(dir, "package.json");
    const cur = JSON.parse(readFileSync(p, "utf8"));
    const next = { ...cur, ...patch.packageJson };
    if (patch.packageJson.scripts)
      next.scripts = { ...(cur.scripts ?? {}), ...(patch.packageJson.scripts as object) };
    writeFileSync(p, `${JSON.stringify(next, null, 2)}\n`);
  }
  if (patch.envExample) {
    const p = path.join(dir, ".env.example");
    writeFileSync(p, patch.envExample);
  }
  if (patch.files) {
    for (const [rel, content] of Object.entries(patch.files)) {
      const p = path.join(dir, rel);
      mkdirSync(path.dirname(p), { recursive: true });
      writeFileSync(p, content);
    }
  }
}

export function assertNoWrites(
  pre: Map<string, string>,
  post: Map<string, string>,
  ignore?: Set<string>,
): boolean {
  for (const [k, v] of pre) {
    if (ignore?.has(k)) continue;
    if (post.get(k) !== v) return false;
  }
  for (const [k] of post) {
    if (ignore?.has(k)) continue;
    if (!pre.has(k)) return false;
  }
  return true;
}
