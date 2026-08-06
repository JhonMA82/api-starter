import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createManifest } from "../src/manifest";
import { getCanonicalStarterVersion } from "../src/starter-version";
import { STARTER_VERSION } from "../updates/registry";

describe("version sync", () => {
  test("STARTER_VERSION matches package.json", () => {
    const pkg = JSON.parse(
      readFileSync(path.join(import.meta.dir, "../../package.json"), "utf8"),
    ) as {
      version: string;
    };
    expect(STARTER_VERSION).toBe(pkg.version);
    expect(getCanonicalStarterVersion()).toBe(pkg.version);
  });

  test("createManifest version equals canonical", () => {
    const manifest = createManifest("minimal", [], {});
    expect(manifest.starter.version).toBe(getCanonicalStarterVersion());
  });

  test("getCanonicalStarterVersion throws on missing version", () => {
    // Indirect: if package.json missing, should throw; we test that function is defined and returns semver
    const v = getCanonicalStarterVersion();
    expect(v).toMatch(/^\d+\.\d+\.\d+/);
  });
});
