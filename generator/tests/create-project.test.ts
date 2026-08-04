import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { excludePath, generateProject, repositoryRoot } from "../src/create-project";
import { GenerationError, UnknownProfileError } from "../src/errors";
import {
  filterMigrationJournal,
  filterMigrationSnapshots,
  journalTagFor,
  type MigrationJournal,
  snapshotNameFor,
} from "../src/migrations";
import {
  ALL_MIGRATIONS,
  ALL_MODULES,
  ALL_PACKAGES,
  type ProjectPlan,
  planFeatureSet,
  planProject,
} from "../src/plan";
import {
  computeRemoveList,
  rewriteAppPackageJson,
  rewriteConfigEnv,
  rewriteDrizzleConfig,
  rewriteEnvExample,
  rewriteRootPackageJson,
  rewriteTsconfig,
  rewriteWorkspaces,
} from "../src/prune";
import { selectTemplates } from "../src/templates";

const repoRoot = repositoryRoot();

function sortedFiles(dir: string): string[] {
  return readdirSync(dir).sort();
}

function walkFiles(root: string): string[] {
  const results: string[] = [];
  const walk = (dir: string, rel: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const entryRel = rel === "" ? entry.name : `${rel}/${entry.name}`;
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(entryPath, entryRel);
      } else {
        results.push(entryRel);
      }
    }
  };
  walk(root, "");
  return results.sort();
}

function isUnder(relativePath: string, removedPaths: string[]): boolean {
  return removedPaths.some(
    (removed) => relativePath === removed || relativePath.startsWith(`${removed}/`),
  );
}

/**
 * Scans the generated project for @consulting/* imports that point at
 * excluded modules/packages. apps/api/tests is excluded: the WU2 scope prunes
 * app composition (app.ts/routes.ts/http/scripts), not the test suite (see
 * report risks).
 */
function assertNoDanglingImports(treeRoot: string, plan: ProjectPlan): void {
  const keptWorkspace = new Set(plan.keepDependencies);
  const offenders: string[] = [];
  for (const rel of walkFiles(treeRoot)) {
    if (!rel.endsWith(".ts") || rel.startsWith("apps/api/tests/")) {
      continue;
    }
    const source = readFileSync(path.join(treeRoot, rel), "utf8");
    for (const match of source.matchAll(/from "@consulting\/([^"]+)"/g)) {
      const name = match[1];
      if (name !== undefined && !keptWorkspace.has(`@consulting/${name}`)) {
        offenders.push(`${rel}: @consulting/${name}`);
      }
    }
  }
  expect(offenders.join("\n")).toBe("");
}

describe("planProject", () => {
  test("minimal keeps only base modules, packages, migrations, and env vars", () => {
    const plan = planProject("minimal");
    expect(plan.features).toEqual([]);
    expect(plan.keepModules).toContain("example");
    for (const moduleName of ["notes", "organizations", "files", "jobs", "notifications"]) {
      expect(plan.keepModules).not.toContain(moduleName);
    }
    for (const packageName of ["config", "contracts", "core"]) {
      expect(plan.keepPackages).toContain(packageName);
    }
    for (const packageName of ["auth", "audit", "authorization"]) {
      expect(plan.keepPackages).not.toContain(packageName);
    }
    expect(plan.keepMigrations).toEqual([
      "0000_jazzy_the_renegades.sql",
      "0001_magenta_tenebrous.sql",
    ]);
    expect(plan.removeMigrations).toHaveLength(ALL_MIGRATIONS.length - 2);
    expect(plan.keepEnvVars).toContain("PORT");
    expect(plan.keepEnvVars).not.toContain("DATABASE_URL");
    expect(plan.keepEnvVars).not.toContain("BETTER_AUTH_SECRET");
    expect(plan.removeFiles).toEqual([
      "apps/api/src/http/authorization.ts",
      "scripts/db",
      "scripts/worker.ts",
    ]);
  });

  test("multi-tenant keeps every runtime module and package", () => {
    const plan = planProject("multi-tenant");
    expect(plan.keepModules).toContain("organizations");
    expect(plan.keepModules).toContain("notes");
    expect(plan.keepModules).toContain("files");
    expect(plan.removeModules).toEqual([]);
    expect(plan.keepPackages).toContain("auth");
    expect(plan.keepPackages).toContain("authorization");
    expect(plan.keepPackages).toContain("audit");
    expect(plan.removePackages).toEqual(["sdk"]);
    expect(plan.keepMigrations).toEqual([...ALL_MIGRATIONS].sort());
    expect(plan.removeMigrations).toEqual([]);
    expect(plan.removeFiles).toEqual([]);
  });

  test("authenticated keeps auth+authorization packages but no organizations module", () => {
    const plan = planProject("authenticated");
    expect(plan.features).toEqual(["persistence", "auth", "authorization"]);
    expect(plan.keepPackages).toContain("auth");
    expect(plan.keepPackages).toContain("auth-client");
    expect(plan.keepPackages).toContain("authorization");
    expect(plan.keepModules).not.toContain("organizations");
    expect(plan.keepModules).toContain("notes");
    expect(plan.keepMigrations).toHaveLength(3);
  });

  test("unknown profile throws UnknownProfileError", () => {
    expect(() => planProject("nope")).toThrow(UnknownProfileError);
  });

  test("catalog constants match the repository layout (drift guard)", () => {
    expect([...ALL_MODULES] as string[]).toEqual(sortedFiles(path.join(repoRoot, "modules")));
    expect([...ALL_PACKAGES] as string[]).toEqual(sortedFiles(path.join(repoRoot, "packages")));
    const migrations = readdirSync(path.join(repoRoot, "migrations"))
      .filter((name) => name.endsWith(".sql"))
      .sort();
    expect([...ALL_MIGRATIONS] as string[]).toEqual(migrations);
  });
});

describe("prune rewrites", () => {
  test("rewriteRootPackageJson drops notes and drizzle pins without persistence", () => {
    const source = readFileSync(path.join(repoRoot, "package.json"), "utf8");
    const minimal = JSON.parse(rewriteRootPackageJson(source, planProject("minimal"))) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
      scripts: Record<string, string>;
    };
    expect(minimal.dependencies["@consulting/module-notes"]).toBeUndefined();
    expect(minimal.dependencies["drizzle-orm"]).toBeUndefined();
    expect(minimal.devDependencies["drizzle-kit"]).toBeUndefined();
    expect(minimal.dependencies["drizzle-orm"]).toBeUndefined();
    expect(minimal.devDependencies["@biomejs/biome"]).toBeDefined();
    expect(minimal.devDependencies.typescript).toBeDefined();
    expect(minimal.scripts).toBeDefined();

    const withDb = JSON.parse(rewriteRootPackageJson(source, planProject("data-api"))) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(withDb.dependencies["@consulting/module-notes"]).toBe("workspace:*");
    expect(withDb.dependencies["drizzle-orm"]).toBe("0.45.2");
    expect(withDb.devDependencies["drizzle-kit"]).toBe("0.31.10");
  });

  test("rewriteAppPackageJson drops feature packages", () => {
    const source = readFileSync(path.join(repoRoot, "apps/api/package.json"), "utf8");
    const minimal = JSON.parse(rewriteAppPackageJson(source, planProject("minimal"))) as {
      dependencies: Record<string, string>;
    };
    expect(minimal.dependencies["@consulting/auth"]).toBeUndefined();
    expect(minimal.dependencies["@consulting/audit"]).toBeUndefined();
    expect(minimal.dependencies["@consulting/authorization"]).toBeUndefined();
    expect(minimal.dependencies["@consulting/module-files"]).toBeUndefined();
    expect(minimal.dependencies["@consulting/module-organizations"]).toBeUndefined();
    expect(minimal.dependencies["@consulting/config"]).toBe("workspace:*");
    expect(minimal.dependencies["@consulting/core"]).toBe("workspace:*");
    expect(minimal.dependencies["@consulting/contracts"]).toBe("workspace:*");
    expect(minimal.dependencies["@consulting/module-example"]).toBe("workspace:*");
    expect(minimal.dependencies.hono).toBeDefined();
    expect(minimal.dependencies.zod).toBeDefined();

    const full = JSON.parse(rewriteAppPackageJson(source, planProject("multi-tenant"))) as {
      dependencies: Record<string, string>;
    };
    expect(full.dependencies["@consulting/auth"]).toBe("workspace:*");
    expect(full.dependencies["@consulting/module-organizations"]).toBe("workspace:*");
  });

  test("rewriteDrizzleConfig prunes schema entries of removed dirs", () => {
    const source = readFileSync(path.join(repoRoot, "drizzle.config.ts"), "utf8");
    const minimal = rewriteDrizzleConfig(source, planProject("minimal"));
    expect(minimal).not.toContain("./modules/notes/");
    expect(minimal).not.toContain("./packages/auth/");
    expect(minimal).not.toContain("./packages/audit/");
    expect(minimal).toContain('out: "./migrations"');

    const withDb = rewriteDrizzleConfig(source, planProject("data-api"));
    expect(withDb).toContain("./modules/notes/");
    expect(withDb).not.toContain("./packages/auth/");

    const full = rewriteDrizzleConfig(source, planProject("multi-tenant"));
    expect(full).toBe(source);
  });

  test("rewriteEnvExample drops feature env vars and keeps base lines", () => {
    const source = readFileSync(path.join(repoRoot, ".env.example"), "utf8");
    const minimal = rewriteEnvExample(source, planProject("minimal"));
    expect(minimal).not.toContain("DATABASE_URL");
    expect(minimal).not.toContain("BETTER_AUTH_SECRET");
    expect(minimal).not.toContain("TRUSTED_ORIGINS");
    expect(minimal).toContain("PORT=3000");
    expect(minimal).toContain("CORS_ORIGINS");

    const full = rewriteEnvExample(source, planProject("multi-tenant"));
    expect(full).toContain("DATABASE_URL");
    expect(full).toContain("BETTER_AUTH_SECRET");
  });

  test("rewriteConfigEnv makes feature env vars optional when the feature is out", () => {
    const source = readFileSync(path.join(repoRoot, "packages/config/src/env.ts"), "utf8");
    const minimal = rewriteConfigEnv(source, planProject("minimal"));
    expect(minimal).toContain("DATABASE_URL: z.url().optional(),");
    expect(minimal).toContain("BETTER_AUTH_SECRET: z.string().min(32).optional(),");

    const full = rewriteConfigEnv(source, planProject("multi-tenant"));
    expect(full).toBe(source);
  });

  test("rewriteTsconfig is an identity (globs cover pruned dirs)", () => {
    const source = readFileSync(path.join(repoRoot, "tsconfig.json"), "utf8");
    expect(rewriteTsconfig(source, planProject("minimal"))).toBe(source);
  });

  test("rewriteWorkspaces is an identity (workspaces globs are profile-independent)", () => {
    const source = JSON.stringify({ workspaces: ["apps/*", "packages/*", "modules/*"] });
    expect(rewriteWorkspaces(source, planProject("minimal"))).toBe(source);
  });

  test("computeRemoveList covers module, package, migration, and snapshot paths", () => {
    const plan = planProject("minimal");
    const remove = computeRemoveList(plan);
    expect(remove).toContain("modules/notes");
    expect(remove).toContain("packages/auth");
    expect(remove).toContain("migrations/0002_chemical_karen_page.sql");
    expect(remove).toContain("migrations/meta/0002_snapshot.json");
    expect(remove).not.toContain("migrations/0000_jazzy_the_renegades.sql");
    expect(remove).not.toContain("migrations/meta/0000_snapshot.json");
    expect(remove).toContain("scripts/db");
    expect(remove).toContain("apps/api/src/http/authorization.ts");
  });
});

describe("migration journal surgery", () => {
  const allTags = ALL_MIGRATIONS.map(journalTagFor);

  test("filterMigrationJournal keeps kept migrations and renumbers idx", () => {
    const journal: MigrationJournal = {
      version: "7",
      dialect: "postgresql",
      entries: allTags.map((tag, index) => ({
        idx: index,
        version: "7",
        when: 1_785_730_400_221 + index,
        tag,
        breakpoints: true,
      })),
    };
    const keepFiles = [
      "0000_jazzy_the_renegades.sql",
      "0001_magenta_tenebrous.sql",
      "0002_chemical_karen_page.sql",
      "0011_remarkable_yellowjacket.sql",
    ];
    const filtered = JSON.parse(
      filterMigrationJournal(JSON.stringify(journal), keepFiles),
    ) as MigrationJournal;
    expect(filtered.entries).toHaveLength(4);
    expect(filtered.entries.map((entry) => entry.idx)).toEqual([0, 1, 2, 3]);
    expect(filtered.entries.map((entry) => entry.tag)).toEqual([
      "0000_jazzy_the_renegades",
      "0001_magenta_tenebrous",
      "0002_chemical_karen_page",
      "0011_remarkable_yellowjacket",
    ]);
    expect(filtered.version).toBe("7");
    expect(filtered.dialect).toBe("postgresql");
  });

  test("filterMigrationSnapshots keeps only snapshots of kept migrations", () => {
    const metaEntries = [...allTags.map(snapshotNameFor), "_journal.json"];
    const kept = filterMigrationSnapshots(metaEntries, ["0002_chemical_karen_page.sql"]);
    expect(kept).toEqual(["0002_snapshot.json", "_journal.json"]);
  });

  test("snapshotNameFor derives the snapshot from the numeric prefix", () => {
    expect(snapshotNameFor("0004_rainy_living_mummy.sql")).toBe("0004_snapshot.json");
    expect(journalTagFor("0004_rainy_living_mummy.sql")).toBe("0004_rainy_living_mummy");
    expect(() => snapshotNameFor("no_prefix.sql")).toThrow();
  });
});

describe("template selection", () => {
  test("variant files exist and carry the generator marker (drift guard)", () => {
    const templatesDir = path.join(repoRoot, "generator", "templates", "app");
    const variants = [
      "app.base.ts",
      "app.auth.ts",
      "app.auth-only.ts",
      "routes.base.ts",
      "routes.auth.ts",
      "routes.tenancy.ts",
    ];
    for (const variant of variants) {
      const content = readFileSync(path.join(templatesDir, variant), "utf8");
      expect(content.startsWith("// generated by @consulting/generator")).toBe(true);
    }
  });

  test("every profile maps to existing template variants", () => {
    const templatesDir = path.join(repoRoot, "generator", "templates", "app");
    for (const profileId of ["minimal", "data-api", "authenticated", "multi-tenant", "platform"]) {
      const selection = selectTemplates(planProject(profileId));
      expect(existsSync(path.join(templatesDir, selection.app))).toBe(true);
      expect(existsSync(path.join(templatesDir, selection.routes))).toBe(true);
    }
  });

  test("selection follows the feature set", () => {
    expect(selectTemplates(planProject("minimal"))).toEqual({
      app: "app.base.ts",
      routes: "routes.base.ts",
    });
    expect(selectTemplates(planProject("data-api"))).toEqual({
      app: "app.base.ts",
      routes: "routes.base.ts",
    });
    expect(selectTemplates(planFeatureSet(["auth"]))).toEqual({
      app: "app.auth-only.ts",
      routes: "routes.base.ts",
    });
    expect(selectTemplates(planProject("authenticated"))).toEqual({
      app: "app.auth.ts",
      routes: "routes.auth.ts",
    });
    expect(selectTemplates(planProject("multi-tenant"))).toEqual({
      app: "app.auth.ts",
      routes: "routes.tenancy.ts",
    });
    expect(selectTemplates(planProject("platform"))).toEqual({
      app: "app.auth.ts",
      routes: "routes.tenancy.ts",
    });
  });
});

describe("create-project end-to-end", () => {
  test("minimal: physical exclusion, journal surgery, safe fail, force overwrite", () => {
    const root = mkdtempSync(path.join(tmpdir(), "gen-min-"));
    try {
      const out = path.join(root, "out");
      const plan = generateProject("minimal", out);

      expect(existsSync(path.join(out, "modules/example"))).toBe(true);
      expect(existsSync(path.join(out, "modules/notes"))).toBe(false);
      expect(existsSync(path.join(out, "modules/organizations"))).toBe(false);
      expect(existsSync(path.join(out, "packages/auth"))).toBe(false);
      expect(existsSync(path.join(out, "packages/audit"))).toBe(false);
      expect(existsSync(path.join(out, "packages/authorization"))).toBe(false);
      expect(existsSync(path.join(out, "scripts/db"))).toBe(false);

      const sqlFiles = readdirSync(path.join(out, "migrations"))
        .filter((name) => name.endsWith(".sql"))
        .sort();
      expect(sqlFiles).toEqual(["0000_jazzy_the_renegades.sql", "0001_magenta_tenebrous.sql"]);
      expect(sortedFiles(path.join(out, "migrations/meta"))).toEqual([
        "0000_snapshot.json",
        "0001_snapshot.json",
        "_journal.json",
      ]);
      const journal = JSON.parse(
        readFileSync(path.join(out, "migrations/meta/_journal.json"), "utf8"),
      ) as MigrationJournal;
      expect(journal.entries).toHaveLength(2);
      expect(journal.entries.map((entry) => [entry.idx, entry.tag])).toEqual([
        [0, "0000_jazzy_the_renegades"],
        [1, "0001_magenta_tenebrous"],
      ]);

      const appSource = readFileSync(path.join(out, "apps/api/src/app.ts"), "utf8");
      expect(appSource).toContain("// generated by @consulting/generator");
      expect(appSource).not.toContain("@consulting/auth");
      expect(appSource).not.toContain("requirePermission");
      const routesSource = readFileSync(path.join(out, "apps/api/src/routes.ts"), "utf8");
      expect(routesSource).not.toContain("@consulting/module-organizations");
      expect(routesSource).not.toContain("@consulting/module-files");
      expect(routesSource).not.toContain("@consulting/auth");
      expect(existsSync(path.join(out, "apps/api/src/http/authorization.ts"))).toBe(false);

      // Feature-owned app tests are pruned: auth/authorization/tenancy/files
      // tests only survive when their feature is selected.
      const appTests = readdirSync(path.join(out, "apps/api/tests")).sort();
      expect(appTests).toEqual([
        "app.test.ts",
        "boundary.test.ts",
        "openapi.test.ts",
        "shutdown.test.ts",
      ]);

      const rootPkg = JSON.parse(readFileSync(path.join(out, "package.json"), "utf8")) as {
        dependencies: Record<string, string>;
      };
      expect(rootPkg.dependencies["@consulting/module-notes"]).toBeUndefined();
      expect(rootPkg.dependencies["drizzle-orm"]).toBeUndefined();
      const appPkg = JSON.parse(readFileSync(path.join(out, "apps/api/package.json"), "utf8")) as {
        dependencies: Record<string, string>;
      };
      expect(appPkg.dependencies["@consulting/module-notes"]).toBeUndefined();
      expect(appPkg.dependencies["@consulting/auth"]).toBeUndefined();

      const envExample = readFileSync(path.join(out, ".env.example"), "utf8");
      expect(envExample).not.toContain("DATABASE_URL");
      expect(envExample).not.toContain("BETTER_AUTH_SECRET");
      const configEnv = readFileSync(path.join(out, "packages/config/src/env.ts"), "utf8");
      expect(configEnv).toContain("DATABASE_URL: z.url().optional()");
      expect(configEnv).toContain("BETTER_AUTH_SECRET: z.string().min(32).optional()");

      expect(existsSync(path.join(out, "GENERATED.md"))).toBe(true);
      expect(existsSync(path.join(out, "bun.lock"))).toBe(true);
      expect(existsSync(path.join(out, ".env"))).toBe(false);
      expect(existsSync(path.join(out, "generator"))).toBe(false);

      assertNoDanglingImports(out, plan);

      const expectedFiles = walkFiles(repoRoot)
        .filter((rel) => !excludePath(rel))
        .filter((rel) => !isUnder(rel, computeRemoveList(plan)));
      expect(walkFiles(out)).toEqual([...expectedFiles, "GENERATED.md"].sort());

      expect(() => generateProject("minimal", out)).toThrow(GenerationError);
      expect(() => generateProject("minimal", out)).toThrow(/--force/);

      generateProject("minimal", out, { force: true });
      expect(existsSync(path.join(out, "modules/example"))).toBe(true);
      expect(existsSync(path.join(out, "modules/notes"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("multi-tenant: keeps feature modules, packages, and all 12 migrations", () => {
    const root = mkdtempSync(path.join(tmpdir(), "gen-mt-"));
    try {
      const out = path.join(root, "out");
      const plan = generateProject("multi-tenant", out);

      for (const moduleName of [
        "example",
        "notes",
        "organizations",
        "files",
        "jobs",
        "notifications",
      ]) {
        expect(existsSync(path.join(out, "modules", moduleName))).toBe(true);
      }
      for (const packageName of [
        "config",
        "contracts",
        "core",
        "auth",
        "auth-client",
        "audit",
        "authorization",
      ]) {
        expect(existsSync(path.join(out, "packages", packageName))).toBe(true);
      }
      expect(existsSync(path.join(out, "scripts/db"))).toBe(true);

      const sqlFiles = readdirSync(path.join(out, "migrations"))
        .filter((name) => name.endsWith(".sql"))
        .sort();
      expect(sqlFiles).toEqual([...ALL_MIGRATIONS].sort());
      const journal = JSON.parse(
        readFileSync(path.join(out, "migrations/meta/_journal.json"), "utf8"),
      ) as MigrationJournal;
      expect(journal.entries).toHaveLength(12);
      expect(journal.entries.map((entry) => entry.idx)).toEqual([...Array(12).keys()]);
      expect(journal.entries[11]?.tag).toBe("0011_remarkable_yellowjacket");

      const appSource = readFileSync(path.join(out, "apps/api/src/app.ts"), "utf8");
      expect(appSource).toContain("@consulting/auth");
      const routesSource = readFileSync(path.join(out, "apps/api/src/routes.ts"), "utf8");
      expect(routesSource).toContain("@consulting/module-organizations");
      expect(routesSource).toContain("@consulting/module-files");

      const rootPkg = JSON.parse(readFileSync(path.join(out, "package.json"), "utf8")) as {
        dependencies: Record<string, string>;
      };
      expect(rootPkg.dependencies["@consulting/module-notes"]).toBe("workspace:*");
      expect(rootPkg.dependencies["drizzle-orm"]).toBe("0.45.2");
      const envExample = readFileSync(path.join(out, ".env.example"), "utf8");
      expect(envExample).toContain("DATABASE_URL");
      expect(envExample).toContain("BETTER_AUTH_SECRET");

      assertNoDanglingImports(out, plan);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("existing empty destination is accepted without --force; filter excludes nested node_modules", () => {
    const root = mkdtempSync(path.join(tmpdir(), "gen-empty-"));
    try {
      const out = path.join(root, "out");
      mkdirSync(out);
      const plan = generateProject("minimal", out);
      expect(
        walkFiles(path.join(out, "packages/config")).some((rel) => rel.includes("node_modules")),
      ).toBe(false);
      expect(existsSync(path.join(out, "modules/example"))).toBe(true);
      assertNoDanglingImports(out, plan);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("generating into the repository itself is refused", () => {
    expect(() => generateProject("minimal", repoRoot)).toThrow(GenerationError);
    const nested = path.join(repoRoot, "tmp-generated");
    expect(() => generateProject("minimal", nested)).toThrow(GenerationError);
  });
});
