import { validateFeatureSet, validateProfile } from "./validate";

const USAGE = `usage: bun generator/src/cli-validate.ts --features <id,id,... | [json]>
       bun generator/src/cli-validate.ts --profile <profile-id>`;

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

const args = process.argv.slice(2);
const featuresIndex = args.indexOf("--features");
const profileIndex = args.indexOf("--profile");

if (featuresIndex === -1 && profileIndex === -1) {
  fail("missing --features or --profile");
}
if (featuresIndex !== -1 && profileIndex !== -1) {
  fail("pass either --features or --profile, not both");
}

if (featuresIndex !== -1) {
  const raw = args[featuresIndex + 1];
  if (raw === undefined) {
    fail("missing value for --features");
  }
  const features = parseFeatureList(raw);
  const issues = validateFeatureSet(features);
  if (issues.length > 0) {
    printIssues(issues);
    process.exit(1);
  }
  console.log(`ok: ${features.length} feature(s) valid`);
  process.exit(0);
}

const profileId = args[profileIndex + 1];
if (profileId === undefined) {
  fail("missing value for --profile");
}
const result = validateProfile(profileId);
if ("errors" in result) {
  printIssues(result.errors);
  process.exit(1);
}
console.log(`ok: profile "${profileId}" resolves to ${result.features.length} feature(s)`);
process.exit(0);
