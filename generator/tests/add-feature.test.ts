import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  addFeature,
  FeatureAdditionError,
  featurePlanFor,
  readGeneratedManifest,
  resolveFeatureClosure,
  updateGeneratedManifest,
} from "../src/add-feature";
import { generateProject, repositoryRoot } from "../src/create-project";
import type { MigrationJournal } from "../src/migrations";

const repoRoot = repositoryRoot();

function walkFiles(root: string, relative = ""): string[] {
  const directory = path.join(root, relative);
  const result: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const child = relative === "" ? entry.name : `${relative}/${entry.name}`;
    if (entry.isDirectory()) {
      result.push(...walkFiles(root, child));
    } else {
      result.push(child);
    }
  }
  return result.sort();
}

function snapshot(root: string): string {
  return walkFiles(root)
    .map((relative) => `${relative}\n${readFileSync(path.join(root, relative), "utf8")}`)
    .join("\n");
}

function temporaryProject(profile = "minimal"): { root: string; project: string } {
  const root = mkdtempSync(path.join(tmpdir(), "add-feature-"));
  const project = path.join(root, "project");
  generateProject(profile, project);
  return { root, project };
}

function journalTags(project: string): string[] {
  const journal = JSON.parse(
    readFileSync(path.join(project, "migrations/meta/_journal.json"), "utf8"),
  ) as MigrationJournal;
  return journal.entries.map((entry) => entry.tag);
}

describe("add-feature pure helpers", () => {
  test("parses the generated manifest and normalizes multitenancy", () => {
    const source = [
      "# GENERATED project",
      "",
      "- profile: minimal",
      "- features: multitenancy",
      "- generated at: 2026-08-03T00:00:00.000Z",
      "",
      "custom notes stay here",
      "",
    ].join("\n");

    expect(readGeneratedManifest(source)).toEqual({
      profile: "minimal",
      features: ["tenancy"],
    });
    const updated = updateGeneratedManifest(source, ["tenancy", "auth"]);
    expect(updated).toContain("- features: tenancy, auth");
    expect(updated).toContain("Added features:");
    expect(updated).toContain("custom notes stay here");
    expect(updated).toContain("generated at: 2026-08-03T00:00:00.000Z");
  });

  test("resolves transitive requirements in deterministic dependency order", () => {
    expect(resolveFeatureClosure("apiKeys", [], true)).toEqual(["auth", "tenancy", "apiKeys"]);
    expect(resolveFeatureClosure("multitenancy", ["auth"], true)).toEqual(["tenancy"]);
    expect(resolveFeatureClosure("apiKeys", ["auth", "tenancy"], true)).toEqual(["apiKeys"]);
    expect(featurePlanFor(["auth", "tenancy", "apiKeys"]).keepModules).toContain("organizations");
  });

  test("rejects unknown, missing-marker, and malformed manifests", () => {
    expect(() => readGeneratedManifest("not a generated project")).toThrow(/generated project/);
    expect(() => readGeneratedManifest("# GENERATED project\n- profile: minimal\n")).toThrow(
      /features/,
    );
    expect(() => readGeneratedManifest("# GENERATED project\n- features: auth\n")).toThrow(
      /profile/,
    );

    const { root, project } = temporaryProject();
    try {
      expect(() => addFeature({ feature: "unknown", project })).toThrow(/Unknown feature/);
      writeFileSync(
        path.join(project, "GENERATED.md"),
        "# GENERATED project\n- profile: minimal\n",
      );
      expect(() => addFeature({ feature: "auth", project })).toThrow(/malformed/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("addFeature resources", () => {
  test("adds auth to minimal and is a no-op on repeat", () => {
    const { root, project } = temporaryProject();
    try {
      const result = addFeature({ feature: "auth", project });
      expect(result.status).toBe("added");
      expect(result.addedFeatures).toEqual(["auth"]);
      expect(existsSync(path.join(project, "packages/auth"))).toBe(true);
      expect(existsSync(path.join(project, "packages/auth-client"))).toBe(true);
      expect(existsSync(path.join(project, "migrations/0002_chemical_karen_page.sql"))).toBe(true);
      expect(existsSync(path.join(project, "apps/api/tests/auth.test.ts"))).toBe(true);
      expect(existsSync(path.join(project, "apps/api/tests/auth-openapi.test.ts"))).toBe(true);
      expect(readFileSync(path.join(project, "apps/api/src/app.ts"), "utf8")).toContain(
        "@consulting/auth",
      );
      expect(readFileSync(path.join(project, "apps/api/package.json"), "utf8")).toContain(
        "@consulting/auth",
      );
      expect(readFileSync(path.join(project, ".env.example"), "utf8")).toContain(
        "BETTER_AUTH_SECRET",
      );
      expect(journalTags(project)).toContain("0002_chemical_karen_page");
      expect(readFileSync(path.join(project, "GENERATED.md"), "utf8")).toContain(
        "- features: auth",
      );
      expect(existsSync(path.join(project, "FEATURE_PLAN.md"))).toBe(true);

      const beforeRepeat = snapshot(project);
      const repeated = addFeature({ feature: "auth", project });
      expect(repeated).toEqual({
        feature: "auth",
        addedFeatures: [],
        copiedPaths: [],
        rewrittenPaths: [],
        status: "already-enabled",
        dryRun: false,
      });
      expect(snapshot(project)).toBe(beforeRepeat);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("requires tenancy for apiKeys unless with-requires is explicit", () => {
    const { root, project } = temporaryProject();
    try {
      try {
        addFeature({ feature: "apiKeys", project });
        expect.unreachable("apiKeys should require tenancy");
      } catch (error) {
        expect(error).toBeInstanceOf(FeatureAdditionError);
        expect((error as FeatureAdditionError).result.errors[0]?.kind).toBe("missing-requirement");
        expect((error as FeatureAdditionError).message).toContain("--with-requires");
      }

      const result = addFeature({ feature: "apiKeys", project, withRequires: true });
      expect(result.addedFeatures).toEqual(["auth", "tenancy", "apiKeys"]);
      expect(existsSync(path.join(project, "modules/organizations"))).toBe(true);
      expect(
        walkFiles(project).filter((relative) => relative === "modules/organizations/package.json"),
      ).toHaveLength(1);
      expect(journalTags(project)).toEqual([
        "0000_jazzy_the_renegades",
        "0001_magenta_tenebrous",
        "0002_chemical_karen_page",
        "0004_rainy_living_mummy",
        "0007_api_keys",
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("adding tenancy emits a non-executed migration plan and preserves data", () => {
    const { root, project } = temporaryProject();
    try {
      const dataPath = path.join(project, "custom-data.json");
      writeFileSync(dataPath, '{"organization":"keep"}\n');
      const result = addFeature({ feature: "tenancy", project, withRequires: true });
      expect(result.warning).toContain("No data was modified");
      expect(result.migrationPlan?.executed).toBe(false);
      expect(result.migrationPlan?.status).toBe("not-executed");
      expect(result.migrationPlan?.steps).toHaveLength(6);
      const featurePlan = readFileSync(path.join(project, "FEATURE_PLAN.md"), "utf8");
      expect(featurePlan).toContain("Tenancy warning");
      expect(featurePlan).toContain("Migration plan (not executed)");
      expect(featurePlan).toContain("Backfill organization and membership data.");
      expect(readFileSync(dataPath, "utf8")).toBe('{"organization":"keep"}\n');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("refuses a customized generated template without force", () => {
    const { root, project } = temporaryProject();
    try {
      const appPath = path.join(project, "apps/api/src/app.ts");
      writeFileSync(
        appPath,
        readFileSync(appPath, "utf8").replace("// generated by @consulting/generator", ""),
      );
      const customPath = path.join(project, "custom-file.txt");
      writeFileSync(customPath, "custom content\n");

      expect(() => addFeature({ feature: "auth", project })).toThrow(/custom file/);
      expect(existsSync(path.join(project, "packages/auth"))).toBe(false);
      expect(readFileSync(customPath, "utf8")).toBe("custom content\n");

      const forced = addFeature({ feature: "auth", project, force: true });
      expect(forced.status).toBe("added");
      expect(readFileSync(appPath, "utf8")).toContain("generated by @consulting/generator");
      expect(readFileSync(customPath, "utf8")).toBe("custom content\n");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("adds persistence resources, configuration, and base migrations", () => {
    const { root, project } = temporaryProject();
    try {
      const result = addFeature({ feature: "persistence", project });
      expect(result.addedFeatures).toEqual(["persistence"]);
      expect(existsSync(path.join(project, "modules/notes"))).toBe(true);
      expect(existsSync(path.join(project, "scripts/db/migrate.ts"))).toBe(true);
      expect(existsSync(path.join(project, "scripts/db/seed.ts"))).toBe(true);
      expect(existsSync(path.join(project, "migrations/0000_jazzy_the_renegades.sql"))).toBe(true);
      expect(existsSync(path.join(project, "migrations/0001_magenta_tenebrous.sql"))).toBe(true);
      expect(readFileSync(path.join(project, ".env.example"), "utf8")).toContain("DATABASE_URL");
      expect(readFileSync(path.join(project, "packages/config/src/env.ts"), "utf8")).toContain(
        "DATABASE_URL: z.url(),",
      );
      const packageJson = JSON.parse(readFileSync(path.join(project, "package.json"), "utf8")) as {
        dependencies: Record<string, string>;
        devDependencies: Record<string, string>;
      };
      expect(packageJson.dependencies["@consulting/module-notes"]).toBe("workspace:*");
      expect(packageJson.dependencies["drizzle-orm"]).toBe("0.45.2");
      expect(packageJson.devDependencies["drizzle-kit"]).toBe("0.31.10");
      expect(journalTags(project)).toEqual(["0000_jazzy_the_renegades", "0001_magenta_tenebrous"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("adds files, jobs, and notifications with their requirements", () => {
    const { root, project } = temporaryProject();
    try {
      const files = addFeature({ feature: "files", project, withRequires: true });
      expect(files.addedFeatures).toEqual(["auth", "tenancy", "files"]);
      const notifications = addFeature({ feature: "notifications", project, withRequires: true });
      expect(notifications.addedFeatures).toEqual(["persistence", "jobs", "notifications"]);
      for (const relative of [
        "modules/files/package.json",
        "modules/jobs/package.json",
        "modules/notifications/package.json",
        "modules/notes/package.json",
      ]) {
        expect(existsSync(path.join(project, relative))).toBe(true);
      }
      const env = readFileSync(path.join(project, ".env.example"), "utf8");
      expect(env).toContain("S3_ENDPOINT");
      expect(env).toContain("SMTP_URL");
      const appPackage = JSON.parse(
        readFileSync(path.join(project, "apps/api/package.json"), "utf8"),
      ) as { dependencies: Record<string, string> };
      expect(appPackage.dependencies["@consulting/module-files"]).toBe("workspace:*");
      expect(appPackage.dependencies["@consulting/module-organizations"]).toBe("workspace:*");
      expect(journalTags(project)).toEqual([
        "0000_jazzy_the_renegades",
        "0001_magenta_tenebrous",
        "0002_chemical_karen_page",
        "0004_rainy_living_mummy",
        "0006_sour_tinkerer",
        "0010_rainy_anthem",
        "0011_remarkable_yellowjacket",
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("add-feature CLI", () => {
  test("adds auth, repeats as a no-op, and rejects an invalid feature", () => {
    const { root, project } = temporaryProject();
    try {
      const run = (args: string[]) =>
        spawnSync("/home/juan/.bun/bin/bun", ["generator/src/add-feature.ts", ...args], {
          cwd: repoRoot,
          encoding: "utf8",
        });
      const first = run([`--feature=auth`, `--project=${project}`]);
      expect(first.status).toBe(0);
      expect(String(first.stdout)).toContain("added: auth");
      const repeat = run([`--feature=auth`, `--project=${project}`]);
      expect(repeat.status).toBe(0);
      expect(String(repeat.stdout)).toContain("already enabled");
      const invalid = run([`--feature=bogus`, `--project=${project}`]);
      expect(invalid.status).toBe(1);
      expect(String(invalid.stderr)).toContain("Unknown feature");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
