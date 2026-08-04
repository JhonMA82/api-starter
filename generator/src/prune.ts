import { snapshotNameFor } from "./migrations";
import type { ProjectPlan } from "./plan";

/**
 * Pure tree computation for a project plan: which relative paths to delete,
 * which are guaranteed to be kept, and the content rewrites for files that
 * reference excluded modules/packages.
 */

export function computeRemoveList(plan: ProjectPlan): string[] {
  const remove = [
    ...plan.removeModules.map((name) => `modules/${name}`),
    ...plan.removePackages.map((name) => `packages/${name}`),
    ...plan.removeAppTests.map((name) => `apps/api/tests/${name}`),
    ...plan.removeFiles,
  ];
  for (const migration of plan.removeMigrations) {
    remove.push(`migrations/${migration}`);
    remove.push(`migrations/meta/${snapshotNameFor(migration)}`);
  }
  return remove.sort();
}

/** Root-level files kept unconditionally by the generator (copied as-is). */
export const ALWAYS_KEPT_ROOT_FILES = [
  ".bun-version",
  ".dockerignore",
  ".gitignore",
  "AGENTS.md",
  "CHANGELOG.md",
  "Dockerfile",
  "LICENSE",
  "README.md",
  "biome.json",
  "bun.lock",
  "bunfig.toml",
  "docker-compose.yml",
  "drizzle.config.ts",
  "package.json",
  "tsconfig.json",
] as const;

/**
 * Relative paths the generator guarantees to keep. Used to assert that
 * nothing beyond the remove list is deleted.
 */
export function computeKeepList(plan: ProjectPlan): string[] {
  const keep = [
    ...plan.keepModules.map((name) => `modules/${name}`),
    ...plan.keepPackages.map((name) => `packages/${name}`),
    ...ALWAYS_KEPT_ROOT_FILES,
    "apps/api/package.json",
    "apps/api/src/app.ts",
    "apps/api/src/bootstrap.ts",
    "apps/api/src/http/errors.ts",
    "apps/api/src/http/logger.ts",
    "apps/api/src/routes.ts",
    "apps/api/src/server.ts",
    "migrations/meta/_journal.json",
    ...plan.keepAppTests.map((name) => `apps/api/tests/${name}`),
  ];
  for (const migration of plan.keepMigrations) {
    keep.push(`migrations/${migration}`);
    keep.push(`migrations/meta/${snapshotNameFor(migration)}`);
  }
  if (plan.features.includes("persistence")) {
    keep.push("scripts/db");
  }
  if (plan.features.includes("authorization")) {
    keep.push("apps/api/src/http/authorization.ts");
  }
  return keep.sort();
}

/**
 * Drops workspace deps pointing at removed modules/packages and the
 * persistence-only external pins (drizzle-orm, drizzle-kit). External
 * dependencies that are not feature-tied are kept verbatim.
 */
export function filterWorkspaceDependencies(
  dependencies: Record<string, string>,
  plan: ProjectPlan,
): Record<string, string> {
  const keepWorkspace = new Set(plan.keepDependencies);
  const hasPersistence = plan.features.includes("persistence");
  const filtered: Record<string, string> = {};
  for (const [name, version] of Object.entries(dependencies)) {
    if (name.startsWith("@consulting/")) {
      if (keepWorkspace.has(name)) {
        filtered[name] = version;
      }
      continue;
    }
    if (name === "drizzle-orm" || name === "drizzle-kit") {
      if (hasPersistence) {
        filtered[name] = version;
      }
      continue;
    }
    filtered[name] = version;
  }
  return filtered;
}

function rewritePackageJson(source: string, plan: ProjectPlan): string {
  const root = JSON.parse(source) as Record<string, unknown>;
  const filtered: Record<string, unknown> = { ...root };
  if (typeof filtered.dependencies === "object" && filtered.dependencies !== null) {
    filtered.dependencies = filterWorkspaceDependencies(
      filtered.dependencies as Record<string, string>,
      plan,
    );
  }
  if (typeof filtered.devDependencies === "object" && filtered.devDependencies !== null) {
    filtered.devDependencies = filterWorkspaceDependencies(
      filtered.devDependencies as Record<string, string>,
      plan,
    );
  }
  return `${JSON.stringify(filtered, null, 2)}\n`;
}

/**
 * The workspaces globs ("apps/*", "packages/*", "modules/*") are
 * profile-independent: removed modules/packages simply leave empty glob
 * matches, so no rewrite is needed. Identity by design.
 */
export function rewriteWorkspaces(source: string, _plan: ProjectPlan): string {
  return source;
}

/**
 * Rewrites the root package.json: removes workspace deps pointing at removed
 * modules/packages and drizzle pins when persistence is out. Scripts are kept
 * (harmless; per WU2 spec).
 */
export function rewriteRootPackageJson(source: string, plan: ProjectPlan): string {
  return rewritePackageJson(source, plan);
}

/**
 * Rewrites apps/api/package.json the same way: its dependencies list the
 * feature packages (@consulting/auth, @consulting/module-organizations, ...)
 * and must not reference removed workspace packages or `bun install` fails on
 * the generated project.
 */
export function rewriteAppPackageJson(source: string, plan: ProjectPlan): string {
  return rewritePackageJson(source, plan);
}

/**
 * Rewrites drizzle.config.ts: drops schema entries whose file lives under a
 * removed module or package directory. Line-based — each entry is one line
 * `"./modules/<name>/...",`. The file's surrounding structure is preserved.
 */
export function rewriteDrizzleConfig(source: string, plan: ProjectPlan): string {
  const keepModules = new Set(plan.keepModules);
  const keepPackages = new Set(plan.keepPackages);
  return source
    .split("\n")
    .flatMap((line) => {
      const match = line.match(/^\s*"\.\/(modules|packages)\/([^"/]+)\//);
      if (match === null) {
        return [line];
      }
      const kind = match[1];
      const name = match[2];
      if (kind === undefined || name === undefined) {
        return [line];
      }
      const keep = kind === "modules" ? keepModules.has(name) : keepPackages.has(name);
      return keep ? [line] : [];
    })
    .join("\n");
}

/** Drops env var lines for removed features; keeps base lines and comments. */
export function rewriteEnvExample(source: string, plan: ProjectPlan): string {
  const keepEnvVars = new Set(plan.keepEnvVars);
  return source
    .split("\n")
    .flatMap((line) => {
      const match = line.match(/^#?\s*([A-Z][A-Z0-9_]*)=/);
      const envVar = match?.[1];
      if (envVar !== undefined && !keepEnvVars.has(envVar)) {
        return [];
      }
      return [line];
    })
    .join("\n");
}

/**
 * Rewrites packages/config/src/env.ts: DATABASE_URL and BETTER_AUTH_SECRET
 * are required in the source schema, but the generated .env.example drops
 * them for profiles without persistence/auth. Making them optional keeps the
 * generated project bootable (parseEnv must succeed with the generated
 * .env.example). This is an addition beyond the WU2 deliverable list, noted
 * in the report.
 */
export function rewriteConfigEnv(source: string, plan: ProjectPlan): string {
  let result = source;
  if (!plan.features.includes("persistence")) {
    result = result.replace("DATABASE_URL: z.url(),", "DATABASE_URL: z.url().optional(),");
  }
  if (!plan.features.includes("auth")) {
    result = result.replace(
      "BETTER_AUTH_SECRET: z.string().min(32),",
      "BETTER_AUTH_SECRET: z.string().min(32).optional(),",
    );
  }
  return result;
}

/**
 * The @consulting/* paths map and the include array are directory globs
 * (packages and modules stars, plus the apps/packages/modules/scripts include
 * list) — pruning removed dirs needs no tsconfig change.
 */
export function rewriteTsconfig(source: string, _plan: ProjectPlan): string {
  return source;
}
