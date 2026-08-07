#!/usr/bin/env bun
/**
 * docs:check — link and drift checks for the documentation.
 *
 * Checks (all deterministic, no network, no dependencies):
 *  1. Internal markdown links resolve to existing files/directories.
 *  2. No references to renamed/archived document paths in active docs.
 *  3. `bun run <script>` commands referenced in docs exist in package.json.
 *  4. No stale starter versions in active docs (exempting dated evidence links).
 *  5. All profiles and features from generator/profiles.json and
 *     generator/features.json appear in the reference pages, and the
 *     deprecated profile is marked as deprecated.
 *
 * Usage: bun scripts/check-docs.ts
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const SKIP_DIRS = new Set([
  ".agents",
  ".atl",
  ".codegraph",
  ".comet",
  ".git",
  ".opencode",
  ".superpowers",
  "backups",
  "coverage",
  "integrations",
  "node_modules",
  "openspec",
  "superpowers",
]);
const SKIP_ROOT_FILES = new Set(["CHANGELOG.md", "CLAUDE.md"]);
const ARCHIVE_REL = "docs/archive";

interface DocFile {
  full: string;
  rel: string;
  isArchive: boolean;
}

function collectMdFiles(): DocFile[] {
  const out: DocFile[] = [];
  const walk = (dir: string, rel: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(join(dir, entry.name), rel === "" ? entry.name : `${rel}/${entry.name}`);
      } else if (entry.name.endsWith(".md") && !entry.name.startsWith("OPENCODE_")) {
        if (rel === "" && SKIP_ROOT_FILES.has(entry.name)) continue;
        const fileRel = rel === "" ? entry.name : `${rel}/${entry.name}`;
        out.push({
          full: join(dir, entry.name),
          rel: fileRel,
          isArchive: fileRel.startsWith(ARCHIVE_REL),
        });
      }
    }
  };
  walk(ROOT, "");
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

const problems: string[] = [];
const report = (fileRel: string, message: string) => problems.push(`${fileRel}: ${message}`);

const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const knownScripts = new Set(Object.keys(pkg.scripts ?? {}));

const profiles: Array<{ id: string; deprecated?: boolean }> = JSON.parse(
  readFileSync(join(ROOT, "generator/profiles.json"), "utf8"),
);
const features: Array<{ id: string }> = JSON.parse(
  readFileSync(join(ROOT, "generator/features.json"), "utf8"),
);

const RENAMED_PATHS = [
  {
    pattern: /(?:^|[\s(`[\]])(?:docs\/)?architecture\.md(?:[)`\].,\s]|$)/,
    old: "docs/architecture.md",
    hint: "docs/architecture/overview.md",
  },
  {
    pattern: /updating-generated-projects/,
    old: "docs/updating-generated-projects.md",
    hint: "docs/guides/update-a-generated-project.md",
  },
  {
    pattern: /migrations-runbook/,
    old: "docs/migrations-runbook.md",
    hint: "docs/operations/migrations.md",
  },
  {
    pattern: /(?:docs\/)?backup-restore\.md/,
    old: "docs/backup-restore.md",
    hint: "docs/operations/backup-and-restore.md",
  },
  {
    pattern: /load-test-results\.md/,
    old: "docs/load-test-results.md",
    hint: "docs/archive/verification-reports/load-test-results-2026-08-03.md",
  },
  {
    pattern: /OPENCODE_HONO/,
    old: "docs/OPENCODE_HONO_BACKEND_REUTILIZABLE.md",
    hint: "docs/archive/original-specification.md",
  },
  {
    pattern: /VALIDATION_REPORT/,
    old: "VALIDATION_REPORT.md",
    hint: "docs/archive/verification-reports/final-validation-0.10.0.md",
  },
  {
    pattern: /docs\/feature-proposal-template\.md/,
    old: "docs/feature-proposal-template.md",
    hint: "docs/maintainers/feature-proposal-template.md",
  },
];

const OLD_VERSIONS = [/0\.10\.1\b/, /0\.10\.0\b/];
const DATED_EVIDENCE = /verification-reports|2026-08-03|2026-08-06/;

const LINK_RE = /\[[^\]]*\]\(([^)]+)\)/g;

function checkLinks(doc: DocFile, content: string): void {
  for (const match of content.matchAll(LINK_RE)) {
    const target = (match[1] ?? "").trim();
    if (
      target === "" ||
      target.startsWith("#") ||
      target.startsWith("http://") ||
      target.startsWith("https://") ||
      target.startsWith("mailto:") ||
      target.includes("://")
    ) {
      continue;
    }
    if (target.includes(" ")) {
      report(doc.rel, `link target with spaces (needs URL encoding): "${target}"`);
      continue;
    }
    const pathPart = target.split("#")[0] ?? target;
    const resolved = pathPart.startsWith("/")
      ? join(ROOT, pathPart)
      : join(dirname(doc.full), pathPart);
    if (!existsSync(resolved)) {
      report(
        doc.rel,
        `broken link: "${target}" (resolves to ${relative(ROOT, resolved) || resolved})`,
      );
    }
  }
}

function checkCommandRefs(doc: DocFile, content: string): void {
  for (const match of content.matchAll(/bun run ([a-zA-Z0-9:_-]+)/g)) {
    const script = match[1] ?? "";
    if (!knownScripts.has(script)) {
      report(doc.rel, `unknown script referenced: "bun run ${script}"`);
    }
  }
}

const refProfilesContent = readFileSync(
  join(ROOT, "docs/reference/profiles-and-features.md"),
  "utf8",
);
const chooseProfileContent = readFileSync(
  join(ROOT, "docs/getting-started/choose-a-profile.md"),
  "utf8",
);

function checkCatalog(): void {
  for (const profile of profiles) {
    if (!refProfilesContent.includes(`\`${profile.id}\``)) {
      report(
        "docs/reference/profiles-and-features.md",
        `profile "${profile.id}" missing from reference`,
      );
    }
    if (!chooseProfileContent.includes(`\`${profile.id}\``)) {
      report(
        "docs/getting-started/choose-a-profile.md",
        `profile "${profile.id}" missing from guide`,
      );
    }
    if (profile.deprecated && !refProfilesContent.includes("deprecated")) {
      report(
        "docs/reference/profiles-and-features.md",
        `profile "${profile.id}" is deprecated but not marked in reference`,
      );
    }
  }
  for (const feature of features) {
    if (!refProfilesContent.includes(`\`${feature.id}\``)) {
      report(
        "docs/reference/profiles-and-features.md",
        `feature "${feature.id}" missing from reference`,
      );
    }
  }
}

const files = collectMdFiles();
for (const doc of files) {
  if (doc.isArchive) continue;
  const content = readFileSync(doc.full, "utf8");

  for (const { pattern, old, hint } of RENAMED_PATHS) {
    if (pattern.test(content)) {
      report(doc.rel, `references renamed/archived path "${old}" — use "${hint}"`);
    }
  }
  for (const line of content.split("\n")) {
    if (DATED_EVIDENCE.test(line)) continue;
    if (doc.rel.startsWith("docs/decisions/")) continue; // ADRs record a point in time
    for (const version of OLD_VERSIONS) {
      if (version.test(line)) {
        report(doc.rel, `stale version "${version.source}" (package.json is ${pkg.version})`);
        break;
      }
    }
  }
  checkCommandRefs(doc, content);
  checkLinks(doc, content);
}

checkCatalog();

if (problems.length > 0) {
  for (const problem of [...problems].sort()) {
    console.error(`[docs:check] ${problem}`);
  }
  console.error(`[docs:check] ${problems.length} problem(s) found`);
  process.exit(1);
}
console.log("[docs:check] ok — links, scripts, versions and catalog reference are consistent");
