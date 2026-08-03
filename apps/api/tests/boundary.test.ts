import { expect, test } from "bun:test";
import { type Dirent, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const sourceExtensions = new Set([".cjs", ".js", ".jsx", ".mjs", ".ts", ".tsx"]);

function collectFiles(directory: string): string[] {
  const files: string[] = [];
  const entries = readdirSync(directory, { withFileTypes: true }) as Dirent[];
  for (const entry of entries) {
    if (entry.name === "node_modules") {
      continue;
    }
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(path));
      continue;
    }
    if (entry.name === "package.json" || sourceExtensions.has(path.slice(path.lastIndexOf(".")))) {
      files.push(path);
    }
  }
  return files;
}

function relativePath(path: string): string {
  return relative(repositoryRoot, path).replaceAll("\\", "/");
}

function isAllowedAuthBoundary(path: string): boolean {
  const relativeFile = relativePath(path);
  return (
    relativeFile.startsWith("packages/auth/") || relativeFile.startsWith("packages/auth-client/")
  );
}

test("keeps Better Auth imports inside the server and browser-safe auth packages", () => {
  const roots = ["apps", "modules", "packages"].map((directory) => join(repositoryRoot, directory));
  const files = roots.flatMap((root) => collectFiles(root));
  const disallowedImports: string[] = [];
  const moduleAuthImports: string[] = [];

  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const path = relativePath(file);
    if (
      /(?:from\s+|import\s+|import\s*\(\s*|require\s*\(\s*)["'](?:better-auth(?:["'/]|$)|@better-auth\/)/.test(
        source,
      ) &&
      !isAllowedAuthBoundary(file)
    ) {
      disallowedImports.push(path);
    }
    if (
      path.startsWith("modules/") &&
      /(?:from\s+|import\s+|import\s*\(\s*|require\s*\(\s*)["']@consulting\/auth(?:-client)?["']/.test(
        source,
      )
    ) {
      moduleAuthImports.push(path);
    }
  }

  expect(disallowedImports).toEqual([]);
  expect(moduleAuthImports).toEqual([]);
});

test("does not install Better Auth test utilities or Vitest", () => {
  const packageFiles = [
    join(repositoryRoot, "package.json"),
    ...["apps", "modules", "packages"].flatMap((root) =>
      collectFiles(join(repositoryRoot, root)).filter((file) => file.endsWith("package.json")),
    ),
  ];
  const packageSources = packageFiles.map((file) => readFileSync(file, "utf8")).join("\n");
  const sourceFiles = ["apps", "modules", "packages"].flatMap((root) =>
    collectFiles(join(repositoryRoot, root)).filter((file) => !file.endsWith("package.json")),
  );
  const source = sourceFiles.map((file) => readFileSync(file, "utf8")).join("\n");

  expect(packageSources).not.toContain("@better-auth/test-utils");
  expect(packageSources).not.toMatch(/["']vitest["']/);
  expect(source).not.toMatch(
    /(?:from\s+|import\s+|import\s*\(\s*|require\s*\(\s*)["']@better-auth\/test-utils["']/,
  );
  expect(source).not.toMatch(/(?:from\s+|import\s+|import\s*\(\s*|require\s*\(\s*)["']vitest["']/);
});
