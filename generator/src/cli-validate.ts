import { FEATURES } from "./features";
import { PROFILES } from "./profiles";
import { validateCatalog, validateFeatureSet, validateProfile } from "./validate";

const USAGE = `usage: bun generator/src/cli-validate.ts [--features <id,id,... | [json]>]
       bun generator/src/cli-validate.ts --profile <profile-id>
       bun generator/src/cli-validate.ts [--json]  (validates entire catalog)
       bun generator/src/cli-validate.ts --list-profiles [--json]
       bun generator/src/cli-validate.ts --list-features [--json]
       bun generator/src/cli-validate.ts --help`;

function fail(message: string): never {
  console.error(message);
  console.error(USAGE);
  process.exit(2);
}

function parseFeatureList(raw: string): string[] {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return [];
  }
  if (trimmed.startsWith("[")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      fail(`invalid JSON in --features: ${raw}`);
    }
    if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== "string")) {
      fail(`--features JSON must be an array of strings: ${raw}`);
    }
    return parsed as string[];
  }
  return trimmed
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function printIssues(issues: { kind: string; feature: string; message: string }[]): void {
  for (const issue of issues) {
    console.error(`error [${issue.kind}] ${issue.feature}: ${issue.message}`);
  }
}

function getArgValue(
  args: string[],
  long: string,
  short?: string,
): string | undefined {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === long || (short && arg === short)) {
      return args[i + 1];
    }
    if (arg !== undefined && arg.startsWith(`${long}=`)) {
      return arg.slice(long.length + 1);
    }
  }
  return undefined;
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

const args = process.argv.slice(2);
const asJson = hasFlag(args, "--json");
const help = hasFlag(args, "--help") || hasFlag(args, "-h");
const listProfiles = hasFlag(args, "--list-profiles");
const listFeatures = hasFlag(args, "--list-features");

if (help) {
  console.log(USAGE);
  process.exit(0);
}

if (listProfiles) {
  if (asJson) {
    console.log(JSON.stringify(PROFILES, null, 2));
  } else {
    for (const profile of [...PROFILES].sort((a, b) => a.id.localeCompare(b.id))) {
      const deprecated = profile.deprecated ? " (deprecated)" : "";
      console.log(
        `${profile.id.padEnd(22)} ${profile.description} [${profile.features.join(", ") || "(none)"}]${deprecated}`,
      );
    }
  }
  process.exit(0);
}

if (listFeatures) {
  if (asJson) {
    console.log(JSON.stringify(FEATURES, null, 2));
  } else {
    for (const feature of FEATURES) {
      const req = feature.requires.length > 0 ? feature.requires.join(",") : "-";
      const exc = feature.excludedBy.length > 0 ? feature.excludedBy.join(",") : "-";
      console.log(
        `${feature.id.padEnd(20)} ${feature.description} requires:[${req}] excludedBy:[${exc}]`,
      );
    }
  }
  process.exit(0);
}

const featuresRaw = getArgValue(args, "--features");
const profileRaw = getArgValue(args, "--profile");

if (featuresRaw !== undefined && profileRaw !== undefined) {
  fail("pass either --features or --profile, not both");
}

if (featuresRaw !== undefined) {
  const features = parseFeatureList(featuresRaw);
  const issues = validateFeatureSet(features);
  if (issues.length > 0) {
    if (asJson) {
      console.log(JSON.stringify({ valid: false, issues }, null, 2));
    } else {
      printIssues(issues);
    }
    process.exit(1);
  }
  if (asJson) {
    console.log(JSON.stringify({ valid: true, features }, null, 2));
  } else {
    console.log(`ok: ${features.length} feature(s) valid`);
  }
  process.exit(0);
}

if (profileRaw !== undefined) {
  const result = validateProfile(profileRaw);
  if ("errors" in result) {
    if (asJson) {
      console.log(JSON.stringify({ valid: false, issues: result.errors }, null, 2));
    } else {
      printIssues(result.errors);
    }
    process.exit(1);
  }
  if (asJson) {
    console.log(JSON.stringify({ valid: true, profile: profileRaw, features: result.features }, null, 2));
  } else {
    console.log(`ok: profile "${profileRaw}" resolves to ${result.features.length} feature(s)`);
  }
  process.exit(0);
}

// Default: validate entire catalog
const catalogIssues = validateCatalog();
if (catalogIssues.length > 0) {
  if (asJson) {
    console.log(JSON.stringify({ valid: false, issues: catalogIssues }, null, 2));
  } else {
    printIssues(catalogIssues);
  }
  process.exit(1);
}
if (asJson) {
  console.log(JSON.stringify({ valid: true, profiles: PROFILES.length, features: FEATURES.length }, null, 2));
} else {
  console.log(`ok: catalog valid (${PROFILES.length} profiles, ${FEATURES.length} features)`);
}
process.exit(0);
