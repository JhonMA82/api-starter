import { describe, expect, test } from "bun:test";

import { mergeEnvExample, mergePackageJson } from "../src/file-strategies";

describe("file-strategies", () => {
  test("mergePackageJson preserves local script and dep", () => {
    const current = JSON.stringify(
      {
        name: "my-api",
        version: "1.0.0",
        scripts: { "my:script": "echo hi", build: "tsc" },
        dependencies: { lodash: "1.0.0", "@consulting/auth": "1.0.0" },
      },
      null,
      2,
    );
    const next = JSON.stringify(
      {
        dependencies: { "@consulting/auth": "2.0.0", "drizzle-orm": "0.45.0", lodash: "9.9.9" },
        devDependencies: { "drizzle-kit": "0.31.0" },
      },
      null,
      2,
    );
    const merged = JSON.parse(mergePackageJson(current, next));
    expect(merged.scripts["my:script"]).toBe("echo hi");
    expect(merged.dependencies.lodash).toBe("1.0.0");
    expect(merged.dependencies["@consulting/auth"]).toBe("2.0.0");
    expect(merged.dependencies["drizzle-orm"]).toBe("0.45.0");
    expect(merged.name).toBe("my-api");
  });

  test("mergePackageJson throws on invalid JSON", () => {
    expect(() => mergePackageJson("invalid json", "{}")).toThrow();
    expect(() => mergePackageJson("{}", "invalid")).toThrow();
  });

  test("mergePackageJson removes retired managed dep", () => {
    const current = JSON.stringify(
      { dependencies: { "@consulting/auth": "1.0.0", "@consulting/old": "1.0.0" } },
      null,
      2,
    );
    const next = JSON.stringify({ dependencies: { "@consulting/auth": "1.0.0" } }, null, 2);
    const merged = JSON.parse(mergePackageJson(current, next));
    expect(merged.dependencies["@consulting/old"]).toBeUndefined();
  });

  test("mergeEnvExample preserves comments and local keys", () => {
    const current = "# my comment\nFOO=bar\n# another\nBAZ=qux\n";
    const next = "FOO=bar\nNEW_KEY=hello\n";
    const merged = mergeEnvExample(current, next);
    expect(merged).toContain("# my comment");
    expect(merged).toContain("FOO=bar");
    expect(merged).toContain("BAZ=qux");
    expect(merged).toContain("NEW_KEY=hello");
    expect(merged.indexOf("FOO=bar")).toBeLessThan(merged.indexOf("NEW_KEY=hello"));
  });

  test("mergeEnvExample idempotent second run", () => {
    const current = "A=1\n";
    const next = "A=1\nB=2\n";
    const once = mergeEnvExample(current, next);
    const twice = mergeEnvExample(once, next);
    expect(once).toBe(twice);
  });
});
