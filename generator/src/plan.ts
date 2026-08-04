import { UnknownFeatureError, UnknownProfileError } from "./errors";
import { getFeature } from "./features";
import { validateFeatureSet, validateProfile } from "./validate";

/**
 * The complete set of resource names that exist in this repository. The plan
 * is pure (no fs access), so these constants mirror the repo layout and are
 * drift-guarded by tests (create-project.test.ts asserts they match the
 * directories and files on disk).
 */
export const ALL_MODULES = [
  "example",
  "files",
  "jobs",
  "notes",
  "notifications",
  "organizations",
] as const;

export const ALL_PACKAGES = [
  "audit",
  "auth",
  "auth-client",
  "authorization",
  "config",
  "contracts",
  "core",
  "sdk",
] as const;

export const ALL_MIGRATIONS = [
  "0000_jazzy_the_renegades.sql",
  "0001_magenta_tenebrous.sql",
  "0002_chemical_karen_page.sql",
  "0003_careless_epoch.sql",
  "0004_rainy_living_mummy.sql",
  "0005_smooth_menace.sql",
  "0006_sour_tinkerer.sql",
  "0007_api_keys.sql",
  "0008_breezy_kronos.sql",
  "0009_boring_bloodscream.sql",
  "0010_rainy_anthem.sql",
  "0011_remarkable_yellowjacket.sql",
] as const;

export const ALL_ENV_VARS = [
  "APP_ENV",
  "APP_VERSION",
  "API_BASE_URL",
  "LOG_LEVEL",
  "PORT",
  "HOST",
  "CORS_ORIGINS",
  "DATABASE_URL",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "TRUSTED_ORIGINS",
  "S3_ENDPOINT",
  "S3_BUCKET",
  "SMTP_URL",
] as const;

/** Test files under apps/api/tests/ that exist in this repository. */
export const ALL_APP_TESTS = [
  "app.test.ts",
  "auth-openapi.test.ts",
  "auth.test.ts",
  "authorization.test.ts",
  "boundary.test.ts",
  "files-routes-db.test.ts",
  "metrics.test.ts",
  "openapi.test.ts",
  "shutdown.test.ts",
  "tenancy.test.ts",
] as const;

/** Test files kept in every profile (they only touch base composition). */
export const BASE_APP_TESTS = [
  "app.test.ts",
  "boundary.test.ts",
  "openapi.test.ts",
  "shutdown.test.ts",
] as const;

/**
 * Test files owned by a feature: removed from apps/api/tests when the feature
 * is not selected, because they import the feature's packages/modules.
 */
export const FEATURE_APP_TESTS: Readonly<Record<string, readonly string[]>> = {
  auth: ["auth-openapi.test.ts", "auth.test.ts"],
  authorization: ["authorization.test.ts"],
  files: ["files-routes-db.test.ts"],
  tenancy: ["tenancy.test.ts"],
};

/** Base resources kept in every profile. */
export const BASE_MODULES = ["example"] as const;
export const BASE_PACKAGES = ["config", "contracts", "core"] as const;
export const BASE_ENV_VARS = [
  "APP_ENV",
  "APP_VERSION",
  "API_BASE_URL",
  "LOG_LEVEL",
  "PORT",
  "HOST",
  "CORS_ORIGINS",
] as const;

/**
 * Migrations 0000-0001 are the starter's base schema. The WU1 review labels
 * them persistence-owned (the catalog's persistence feature also lists them),
 * but the WU2 test contract requires every generated project — including
 * `minimal` — to keep 0000/0001 and a renumbered journal, so they are base
 * here and the persistence feature simply re-adds them via its catalog entry.
 */
export const BASE_MIGRATIONS = [
  "0000_jazzy_the_renegades.sql",
  "0001_magenta_tenebrous.sql",
] as const;

/**
 * modules/notes is the persistence reference module: its schema files and the
 * db scripts use drizzle and DATABASE_URL. The catalog's persistence entry
 * declares modules: [] (WU1), so the ownership is resolved here at plan time.
 */
export const PERSISTENCE_MODULES = ["notes"] as const;

export interface ProjectPlan {
  profile: string;
  /** Resolved feature ids (profile presets). */
  features: string[];
  /** modules/ dirs to keep (base modules + feature modules). */
  keepModules: string[];
  /** modules/ dirs to remove. */
  removeModules: string[];
  /** packages/ dirs to keep (base packages + feature packages). */
  keepPackages: string[];
  /** packages/ dirs to remove. */
  removePackages: string[];
  /** Exact migration FILE names to keep (base + feature migrations). */
  keepMigrations: string[];
  /** Exact migration FILE names to remove. */
  removeMigrations: string[];
  /**
   * Dependency names to keep: workspace names of kept modules/packages
   * (@consulting/module-* / @consulting/*) plus drizzle-orm when persistence
   * is selected.
   */
  keepDependencies: string[];
  removeDependencies: string[];
  /** Env var names to keep in .env.example (base + feature env vars). */
  keepEnvVars: string[];
  removeEnvVars: string[];
  /** apps/api/tests/ files to keep (base tests + feature-owned tests). */
  keepAppTests: string[];
  /** apps/api/tests/ files to remove (feature-owned tests of absent features). */
  removeAppTests: string[];
  /** Extra feature-independent root files (kept unconditionally). */
  keepFiles: string[];
  /** Feature-owned files/dirs that must be removed when the feature is out. */
  removeFiles: string[];
}

function sorted(values: Iterable<string>): string[] {
  return [...values].sort();
}

function buildProjectPlan(profileId: string, features: readonly string[]): ProjectPlan {
  const featureSet = new Set(features);

  const keepModules = new Set<string>(BASE_MODULES);
  const keepPackages = new Set<string>(BASE_PACKAGES);
  const keepMigrations = new Set<string>(BASE_MIGRATIONS);
  const keepEnvVars = new Set<string>(BASE_ENV_VARS);
  const keepAppTests = new Set<string>(BASE_APP_TESTS);

  if (featureSet.has("persistence")) {
    for (const moduleName of PERSISTENCE_MODULES) {
      keepModules.add(moduleName);
    }
  }

  for (const featureId of features) {
    const feature = getFeature(featureId);
    for (const moduleName of feature.modules) {
      keepModules.add(moduleName);
    }
    for (const packageName of feature.packages) {
      keepPackages.add(packageName);
    }
    for (const migration of feature.migrations) {
      keepMigrations.add(migration);
    }
    for (const envVar of feature.envVars) {
      keepEnvVars.add(envVar);
    }
    for (const testFile of FEATURE_APP_TESTS[featureId] ?? []) {
      keepAppTests.add(testFile);
    }
  }

  const keepDependencies = new Set<string>();
  for (const moduleName of keepModules) {
    keepDependencies.add(`@consulting/module-${moduleName}`);
  }
  for (const packageName of keepPackages) {
    keepDependencies.add(`@consulting/${packageName}`);
  }
  if (featureSet.has("persistence")) {
    keepDependencies.add("drizzle-orm");
  }

  const removeDependencies = new Set<string>();
  for (const moduleName of ALL_MODULES) {
    if (!keepModules.has(moduleName)) {
      removeDependencies.add(`@consulting/module-${moduleName}`);
    }
  }
  for (const packageName of ALL_PACKAGES) {
    if (!keepPackages.has(packageName)) {
      removeDependencies.add(`@consulting/${packageName}`);
    }
  }
  if (!featureSet.has("persistence")) {
    removeDependencies.add("drizzle-orm");
  }

  const removeFiles: string[] = [];
  if (!featureSet.has("persistence")) {
    // scripts/db (migrate.ts, seed.ts) import @consulting/module-notes and
    // drizzle — persistence-owned tooling.
    removeFiles.push("scripts/db");
  }
  if (!featureSet.has("authorization")) {
    // apps/api/src/http/authorization.ts imports @consulting/auth and
    // @consulting/authorization; it only feeds requirePermission demo routes.
    removeFiles.push("apps/api/src/http/authorization.ts");
  }

  const keepModulesList = sorted(keepModules);
  const keepPackagesList = sorted(keepPackages);
  const keepMigrationsList = sorted(keepMigrations);
  const keepEnvVarsList = sorted(keepEnvVars);
  const keepAppTestsList = sorted(keepAppTests);

  return {
    profile: profileId,
    features: [...features],
    keepModules: keepModulesList,
    removeModules: sorted(ALL_MODULES.filter((name) => !keepModules.has(name))),
    keepPackages: keepPackagesList,
    removePackages: sorted(ALL_PACKAGES.filter((name) => !keepPackages.has(name))),
    keepMigrations: keepMigrationsList,
    removeMigrations: sorted(ALL_MIGRATIONS.filter((name) => !keepMigrations.has(name))),
    keepDependencies: sorted(keepDependencies),
    removeDependencies: sorted(removeDependencies),
    keepEnvVars: keepEnvVarsList,
    removeEnvVars: sorted(ALL_ENV_VARS.filter((name) => !keepEnvVars.has(name))),
    keepAppTests: keepAppTestsList,
    removeAppTests: sorted(ALL_APP_TESTS.filter((name) => !keepAppTests.has(name))),
    keepFiles: [],
    removeFiles: removeFiles.sort(),
  };
}

/**
 * Computes the materialization plan for an arbitrary, already-normalized
 * feature set. This is deliberately pure so incremental tooling can plan a
 * generated project without pretending that it matches a named profile.
 */
export function planFeatureSet(features: readonly string[], profileId = "custom"): ProjectPlan {
  const issues = validateFeatureSet(features);
  const unknown = issues.find((issue) => issue.kind === "unknown-feature");
  if (unknown !== undefined) {
    throw new UnknownFeatureError(unknown.feature);
  }
  if (issues.length > 0) {
    throw new Error(`feature set is invalid: ${issues.map((issue) => issue.message).join("; ")}`);
  }
  return buildProjectPlan(profileId, features);
}

/**
 * Computes the materialization plan for a named profile. Throws
 * UnknownProfileError for unknown profiles.
 */
export function planProject(profileId: string): ProjectPlan {
  const validated = validateProfile(profileId);
  if ("errors" in validated) {
    if (validated.errors.length === 1 && validated.errors[0]?.kind === "unknown-profile") {
      throw new UnknownProfileError(profileId);
    }
    const details = validated.errors.map((issue) => issue.message).join("; ");
    throw new Error(`profile "${profileId}" is invalid: ${details}`);
  }
  return buildProjectPlan(profileId, validated.features);
}
