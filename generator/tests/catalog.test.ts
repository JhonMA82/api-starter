import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { UnknownFeatureError, UnknownProfileError } from "../src/errors";
import { FEATURES, getFeature } from "../src/features";
import { getProfile, PROFILES } from "../src/profiles";
import { serializeFeaturesManifest, serializeProfilesManifest } from "../src/sync-manifests";
import { validateFeatureSet, validateProfile } from "../src/validate";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const featureIds = new Set(FEATURES.map((feature) => feature.id));

describe("feature catalog", () => {
  test("every feature is fully defined and well-formed", () => {
    for (const feature of FEATURES) {
      expect(typeof feature.id).toBe("string");
      expect(feature.id.length).toBeGreaterThan(0);
      expect(typeof feature.description).toBe("string");
      expect(feature.description.length).toBeGreaterThan(0);
      expect(Array.isArray(feature.requires)).toBe(true);
      expect(Array.isArray(feature.excludedBy)).toBe(true);
      expect(Array.isArray(feature.modules)).toBe(true);
      expect(Array.isArray(feature.packages)).toBe(true);
      expect(Array.isArray(feature.migrations)).toBe(true);
      expect(Array.isArray(feature.envVars)).toBe(true);
    }
  });

  test("feature ids are unique", () => {
    const ids = FEATURES.map((feature) => feature.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("requires only references known features", () => {
    for (const feature of FEATURES) {
      for (const requirement of feature.requires) {
        expect(featureIds.has(requirement)).toBe(true);
      }
    }
  });

  test("excludedBy only references known features", () => {
    for (const feature of FEATURES) {
      for (const excludedBy of feature.excludedBy) {
        expect(featureIds.has(excludedBy)).toBe(true);
      }
    }
  });

  test("no feature requires or excludes itself", () => {
    for (const feature of FEATURES) {
      expect(feature.requires).not.toContain(feature.id);
      expect(feature.excludedBy).not.toContain(feature.id);
    }
  });

  test("referenced modules, packages, and migrations exist on disk", () => {
    for (const feature of FEATURES) {
      for (const moduleName of feature.modules) {
        expect(existsSync(`${repositoryRoot}/modules/${moduleName}`)).toBe(true);
      }
      for (const packageName of feature.packages) {
        expect(existsSync(`${repositoryRoot}/packages/${packageName}`)).toBe(true);
      }
      for (const migration of feature.migrations) {
        expect(existsSync(`${repositoryRoot}/migrations/${migration}`)).toBe(true);
      }
    }
  });

  test("getFeature returns the matching definition", () => {
    const expected = FEATURES.find((feature) => feature.id === "tenancy");
    if (!expected) {
      expect.unreachable("tenancy must be present in FEATURES");
    }
    expect(getFeature("tenancy")).toBe(expected);
  });

  test("getFeature throws UnknownFeatureError for unknown ids", () => {
    expect(() => getFeature("nope")).toThrow(UnknownFeatureError);
  });
});

describe("profile catalog", () => {
  test("profile ids are unique", () => {
    const ids = PROFILES.map((profile) => profile.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("every profile references known features", () => {
    for (const profile of PROFILES) {
      for (const featureId of profile.features) {
        expect(featureIds.has(featureId)).toBe(true);
      }
    }
  });

  test("documented presets hold", () => {
    const profile = (id: string) => getProfile(id).features;

    expect(profile("minimal")).toEqual([]);
    expect(profile("minimal")).not.toContain("persistence");
    expect(profile("minimal")).not.toContain("auth");

    expect(profile("data-api")).toEqual(["persistence"]);

    expect(profile("authenticated")).toContain("auth");
    expect(profile("authenticated")).toContain("persistence");

    expect(profile("multi-tenant")).toEqual([
      "persistence",
      "auth",
      "authorization",
      "tenancy",
      "audit",
      "apiKeys",
      "jobs",
      "webhooks",
      "files",
      "notifications",
    ]);
    expect(profile("multi-tenant")).toContain("tenancy");
    expect(profile("multi-tenant")).toContain("auth");

    expect(profile("platform")).toEqual([...profile("multi-tenant"), "observability"]);
  });

  test("getProfile throws UnknownProfileError for unknown ids", () => {
    expect(() => getProfile("nope")).toThrow(UnknownProfileError);
  });
});

describe("validateFeatureSet", () => {
  test("flags unknown feature ids", () => {
    const issues = validateFeatureSet(["bogus"]);
    expect(issues).toEqual([
      { kind: "unknown-feature", feature: "bogus", message: `Unknown feature "bogus"` },
    ]);
  });

  test("flags missing requirements", () => {
    expect(validateFeatureSet(["apiKeys"])).toEqual([
      {
        kind: "missing-requirement",
        feature: "apiKeys",
        message: `Feature "apiKeys" requires "tenancy"`,
      },
    ]);
    expect(validateFeatureSet(["tenancy"])).toEqual([
      {
        kind: "missing-requirement",
        feature: "tenancy",
        message: `Feature "tenancy" requires "auth"`,
      },
    ]);
    expect(validateFeatureSet(["webhooks"])).toEqual([
      {
        kind: "missing-requirement",
        feature: "webhooks",
        message: `Feature "webhooks" requires "tenancy"`,
      },
      {
        kind: "missing-requirement",
        feature: "webhooks",
        message: `Feature "webhooks" requires "jobs"`,
      },
    ]);
    expect(validateFeatureSet(["notifications"])).toEqual([
      {
        kind: "missing-requirement",
        feature: "notifications",
        message: `Feature "notifications" requires "jobs"`,
      },
    ]);
    expect(validateFeatureSet(["audit"])).toEqual([
      {
        kind: "missing-requirement",
        feature: "audit",
        message: `Feature "audit" requires "persistence"`,
      },
    ]);
  });

  test("flags excluded combinations", () => {
    const issues = validateFeatureSet([
      "persistence",
      "auth",
      "tenancy",
      "authorization",
      "dynamicRoles",
    ]);
    expect(issues).toEqual([
      {
        kind: "conflict",
        feature: "dynamicRoles",
        message: `Feature "dynamicRoles" cannot be combined with "authorization"`,
      },
    ]);
  });

  test("flags duplicate feature ids", () => {
    const issues = validateFeatureSet(["persistence", "auth", "auth"]);
    expect(issues).toEqual([
      { kind: "conflict", feature: "auth", message: `Duplicate feature "auth"` },
    ]);
  });

  test("accepts the documented full set", () => {
    expect(validateFeatureSet(getProfile("platform").features)).toEqual([]);
  });

  test("accepts valid partial sets", () => {
    expect(validateFeatureSet([])).toEqual([]);
    expect(validateFeatureSet(["persistence"])).toEqual([]);
    expect(
      validateFeatureSet(["persistence", "auth", "authorization", "tenancy", "audit"]),
    ).toEqual([]);
  });
});

describe("validateProfile", () => {
  test("returns errors for unknown profiles", () => {
    const result = validateProfile("nope");
    expect("errors" in result).toBe(true);
    expect("features" in result).toBe(false);
    if ("errors" in result) {
      expect(result.errors).toEqual([
        { kind: "unknown-profile", feature: "nope", message: `Unknown profile "nope"` },
      ]);
    }
  });

  test("returns the feature list of known profiles", () => {
    const minimal = validateProfile("minimal");
    expect(minimal).toEqual({ features: [] });

    const dataApi = validateProfile("data-api");
    expect(dataApi).toEqual({ features: ["persistence"] });

    const platform = validateProfile("platform");
    expect("features" in platform).toBe(true);
    if ("features" in platform) {
      expect(platform.features).toEqual([...getProfile("multi-tenant").features, "observability"]);
    }
  });
});

describe("JSON manifests", () => {
  test("features.json matches the TypeScript catalog (no drift)", async () => {
    const manifest = await Bun.file(
      fileURLToPath(new URL("../features.json", import.meta.url)),
    ).json();
    expect(manifest).toEqual(serializeFeaturesManifest());
  });

  test("profiles.json matches the TypeScript catalog (no drift)", async () => {
    const manifest = await Bun.file(
      fileURLToPath(new URL("../profiles.json", import.meta.url)),
    ).json();
    expect(manifest).toEqual(serializeProfilesManifest());
  });
});
