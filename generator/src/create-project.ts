import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { GenerationError, UnknownProfileError } from "./errors";
import { filterMigrationJournal } from "./migrations";
import { type ProjectPlan, planProject } from "./plan";
import {
  computeRemoveList,
  rewriteAppPackageJson,
  rewriteConfigEnv,
  rewriteDockerCompose,
  rewriteDrizzleConfig,
  rewriteEnvExample,
  rewriteRootPackageJson,
  rewriteTsconfig,
} from "./prune";
import { selectTemplates } from "./templates";

const USAGE = `usage: bun generator/src/create-project.ts --profile <profile-id> --out <dir> [--force]`;

export function repositoryRoot(): string {
  return fileURLToPath(new URL("../../", import.meta.url));
}

/**
 * Copy filter: relative paths (repo-root based) that must NOT be copied into
 * the generated project. Excludes tooling, local state, secrets, and any
 * node_modules/.git/.codegraph at any depth.
 */
const EXCLUDED_SEGMENTS = new Set([
  ".git",
  ".codegraph",
  ".atl",
  "coverage",
  "dist",
  "generator",
  "node_modules",
]);

const EXCLUDED_BASENAMES = new Set([".env", ".env.test", "OPENCODE_HONO_BACKEND_REUTILIZABLE.md"]);

export function excludePath(relativePath: string): boolean {
  const segments = relativePath.split(path.sep);
  if (segments.some((segment) => EXCLUDED_SEGMENTS.has(segment))) {
    return true;
  }
  const basename = segments[segments.length - 1] ?? "";
  if (EXCLUDED_BASENAMES.has(basename)) {
    return true;
  }
  if (basename.endsWith(".log")) {
    return true;
  }
  return false;
}

function rewrite(target: string, transform: (source: string) => string): void {
  const source = readFileSync(target, "utf8");
  writeFileSync(target, transform(source));
}

/**
 * Materializes a new project at outDir from the profile: copies the
 * repository tree (minus tooling/local state), physically removes excluded
 * modules/packages/migrations, rewrites composition files, and installs the
 * app templates. Throws GenerationError on a non-empty existing destination
 * unless force is set (never silently overwrites).
 */
export function generateProject(
  profileId: string,
  outDir: string,
  options: { force?: boolean } = {},
): ProjectPlan {
  const plan = planProject(profileId);
  const repoRoot = repositoryRoot();
  const outPath = path.resolve(outDir);

  const relativeToRepo = path.relative(repoRoot, outPath);
  if (
    relativeToRepo === "" ||
    (!relativeToRepo.startsWith("..") && !path.isAbsolute(relativeToRepo))
  ) {
    throw new GenerationError(`refusing to generate into the repository itself: ${outPath}`);
  }

  const exists = existsSync(outPath);
  const isEmpty = !exists || readdirSync(outPath).length === 0;
  if (exists && !isEmpty && !options.force) {
    throw new GenerationError(
      `destination ${outPath} exists and is not empty; pass --force to overwrite`,
    );
  }
  if (exists && options.force) {
    rmSync(outPath, { recursive: true, force: true });
  }
  mkdirSync(outPath, { recursive: true });

  cpSync(repoRoot, outPath, {
    recursive: true,
    filter: (src) => !excludePath(path.relative(repoRoot, src)),
  });

  for (const relativePath of computeRemoveList(plan)) {
    rmSync(path.join(outPath, relativePath), { recursive: true, force: true });
  }

  const journalPath = path.join(outPath, "migrations", "meta", "_journal.json");
  rewrite(journalPath, (source) => filterMigrationJournal(source, plan.keepMigrations));

  rewrite(path.join(outPath, "package.json"), (source) => rewriteRootPackageJson(source, plan));
  rewrite(path.join(outPath, "apps", "api", "package.json"), (source) =>
    rewriteAppPackageJson(source, plan),
  );
  rewrite(path.join(outPath, "drizzle.config.ts"), (source) => rewriteDrizzleConfig(source, plan));
  rewrite(path.join(outPath, ".env.example"), (source) => rewriteEnvExample(source, plan));
  rewrite(path.join(outPath, "packages", "config", "src", "env.ts"), (source) =>
    rewriteConfigEnv(source, plan),
  );
  rewrite(path.join(outPath, "tsconfig.json"), (source) => rewriteTsconfig(source, plan));
  rewrite(path.join(outPath, "docker-compose.yml"), (source) => rewriteDockerCompose(source, plan));

  const selection = selectTemplates(plan);
  const templatesDir = path.join(repoRoot, "generator", "templates", "app");
  copyFileSync(
    path.join(templatesDir, selection.app),
    path.join(outPath, "apps", "api", "src", "app.ts"),
  );
  copyFileSync(
    path.join(templatesDir, selection.routes),
    path.join(outPath, "apps", "api", "src", "routes.ts"),
  );

  const featuresLine = plan.features.length === 0 ? "(none)" : plan.features.join(", ");
  const databaseSteps = plan.features.includes("persistence")
    ? "\n- cp .env.example .env (first run)\n- bun run db:up\n- bun run db:migrate"
    : "";
  const marker = `# GENERATED project

This project was materialized by @consulting/generator from the api-starter template.
Do not edit the generator markers (files starting with "// generated by @consulting/generator").

- profile: ${plan.profile}
- features: ${featuresLine}
- generated at: ${new Date().toISOString()}

Next steps:
- bun install
- bun run dev${databaseSteps}
`;
  writeFileSync(path.join(outPath, "GENERATED.md"), marker);

  return plan;
}

function printSummary(plan: ProjectPlan, outPath: string): void {
  const lines = [
    `project materialized at ${outPath}`,
    `profile: ${plan.profile}`,
    `features: ${plan.features.length === 0 ? "(none)" : plan.features.join(", ")}`,
    `kept modules: ${plan.keepModules.join(", ")}`,
    `removed modules: ${plan.removeModules.join(", ") || "(none)"}`,
    `kept packages: ${plan.keepPackages.join(", ")}`,
    `removed packages: ${plan.removePackages.join(", ") || "(none)"}`,
    `kept migrations: ${plan.keepMigrations.length}`,
    `removed migrations: ${plan.removeMigrations.length}`,
    "next steps: bun install; bun run dev",
  ];
  if (plan.features.includes("persistence")) {
    lines.push("  with persistence: cp .env.example .env; bun run db:up; bun run db:migrate");
  }
  console.log(lines.join("\n"));
}

function main(): void {
  const args = process.argv.slice(2);
  let profileId: string | undefined;
  let outDir: string | undefined;
  let force = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) {
      break;
    }
    if (arg === "--force") {
      force = true;
    } else if (arg === "--profile" || arg.startsWith("--profile=")) {
      profileId = arg === "--profile" ? args[index + 1] : arg.slice("--profile=".length);
      if (arg === "--profile") {
        index += 1;
      }
    } else if (arg === "--out" || arg.startsWith("--out=")) {
      outDir = arg === "--out" ? args[index + 1] : arg.slice("--out=".length);
      if (arg === "--out") {
        index += 1;
      }
    } else {
      console.error(`error: unknown argument "${arg}"`);
      console.error(USAGE);
      process.exit(2);
    }
  }

  if (profileId === undefined || outDir === undefined) {
    console.error("error: --profile and --out are required");
    console.error(USAGE);
    process.exit(2);
  }

  try {
    const plan = generateProject(profileId, outDir, { force });
    printSummary(plan, path.resolve(outDir));
  } catch (error) {
    if (error instanceof UnknownProfileError || error instanceof GenerationError) {
      console.error(`error: ${error.message}`);
      process.exit(1);
    }
    throw error;
  }
}

if (import.meta.main) {
  main();
}
