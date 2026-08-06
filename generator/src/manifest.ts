import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import { FEATURES } from "./features";
import { PROFILES } from "./profiles";
import { validateFeatureSet } from "./validate";

export const MANIFEST_SCHEMA_VERSION = 1;
export const MANIFEST_NAME = "@consulting/api-starter";
export const MANIFEST_DIR = ".api-starter";
export const MANIFEST_FILE = "manifest.json";

export type FileStrategy = "managed" | "structured" | "scaffold" | "generated-region" | "ignored";

export interface ManifestFileEntry {
  baselineHash: string;
  strategy: FileStrategy;
}

export interface Manifest {
  schemaVersion: number;
  starter: {
    name: string;
    version: string;
    sourceRevision?: string;
  };
  generation: {
    profile: string;
    features: string[];
    createdAt: string;
    updatedAt: string;
  };
  managedFiles: Record<string, ManifestFileEntry>;
  appliedUpdates: string[];
}

const KNOWN_FEATURES = new Set(FEATURES.map((f) => f.id));
const KNOWN_PROFILES = new Set(PROFILES.map((p) => p.id));

function isIso8601(value: string): boolean {
  const d = Date.parse(value);
  return !Number.isNaN(d);
}

export function stableJsonStringify(value: unknown): string {
  // Biome-compatible pretty print with stable key order
  return `${JSON.stringify(sortKeys(value), null, 2)}\n`;
}

function sortKeys(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sortKeys(item));
  }
  const obj = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = sortKeys(obj[key]);
  }
  return sorted;
}

export function validateManifest(data: unknown): Manifest {
  if (typeof data !== "object" || data === null) {
    throw new Error("manifest is corrupt: expected object");
  }
  const obj = data as Record<string, unknown>;

  if (obj.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    if (typeof obj.schemaVersion === "number" && obj.schemaVersion > MANIFEST_SCHEMA_VERSION) {
      throw new Error(
        `manifest schemaVersion ${obj.schemaVersion} is not supported (max ${MANIFEST_SCHEMA_VERSION}); update the starter tooling`,
      );
    }
    throw new Error(`manifest schemaVersion must be ${MANIFEST_SCHEMA_VERSION}`);
  }

  if (typeof obj.starter !== "object" || obj.starter === null) {
    throw new Error("manifest is corrupt: starter must be object");
  }
  const starter = obj.starter as Record<string, unknown>;
  if (starter.name !== MANIFEST_NAME) {
    throw new Error(`manifest starter.name must be "${MANIFEST_NAME}"`);
  }
  if (typeof starter.version !== "string" || starter.version.length === 0) {
    throw new Error("manifest starter.version must be a non-empty string");
  }
  if (starter.sourceRevision !== undefined && typeof starter.sourceRevision !== "string") {
    throw new Error("manifest starter.sourceRevision must be a string");
  }

  if (typeof obj.generation !== "object" || obj.generation === null) {
    throw new Error("manifest is corrupt: generation must be object");
  }
  const generation = obj.generation as Record<string, unknown>;
  if (typeof generation.profile !== "string" || generation.profile.length === 0) {
    throw new Error("manifest generation.profile must be a non-empty string");
  }
  if (!KNOWN_PROFILES.has(generation.profile) && generation.profile !== "custom") {
    throw new Error(`Unknown profile "${generation.profile}" in manifest`);
  }
  if (!Array.isArray(generation.features)) {
    throw new Error("manifest generation.features must be an array");
  }
  for (const feature of generation.features as unknown[]) {
    if (typeof feature !== "string") {
      throw new Error("manifest generation.features must be strings");
    }
    if (!KNOWN_FEATURES.has(feature)) {
      throw new Error(`Unknown feature "${feature}" in manifest`);
    }
  }
  const featureIssues = validateFeatureSet(generation.features as string[]);
  if (featureIssues.length > 0) {
    throw new Error(
      `manifest generation.features invalid: ${featureIssues.map((i) => i.message).join("; ")}`,
    );
  }
  if (typeof generation.createdAt !== "string" || !isIso8601(generation.createdAt)) {
    throw new Error("manifest generation.createdAt must be an ISO-8601 string");
  }
  if (typeof generation.updatedAt !== "string" || !isIso8601(generation.updatedAt)) {
    throw new Error("manifest generation.updatedAt must be an ISO-8601 string");
  }

  if (
    typeof obj.managedFiles !== "object" ||
    obj.managedFiles === null ||
    Array.isArray(obj.managedFiles)
  ) {
    throw new Error("manifest managedFiles must be an object");
  }
  const managedFiles = obj.managedFiles as Record<string, unknown>;
  for (const [key, entry] of Object.entries(managedFiles)) {
    if (typeof entry !== "object" || entry === null) {
      throw new Error(`manifest managedFiles["${key}"] must be an object`);
    }
    const e = entry as Record<string, unknown>;
    if (typeof e.baselineHash !== "string" || !e.baselineHash.startsWith("sha256:")) {
      throw new Error(`manifest managedFiles["${key}"].baselineHash must be a sha256: hex string`);
    }
    if (
      !["managed", "structured", "scaffold", "generated-region", "ignored"].includes(
        e.strategy as string,
      )
    ) {
      throw new Error(
        `manifest managedFiles["${key}"].strategy must be one of managed, structured, scaffold, generated-region, ignored`,
      );
    }
  }

  if (!Array.isArray(obj.appliedUpdates)) {
    throw new Error("manifest appliedUpdates must be an array");
  }
  for (const update of obj.appliedUpdates as unknown[]) {
    if (typeof update !== "string") {
      throw new Error("manifest appliedUpdates must be strings");
    }
  }

  return data as Manifest;
}

export function manifestPath(projectDir: string): string {
  return path.join(projectDir, MANIFEST_DIR, MANIFEST_FILE);
}

export function readManifest(projectDir: string): Manifest {
  const filePath = manifestPath(projectDir);
  if (!existsSync(filePath)) {
    throw new Error(
      `manifest not found at ${filePath}; run generator:adopt or regenerate the project`,
    );
  }
  const raw = readFileSync(filePath, "utf8");
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `manifest is corrupt: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return validateManifest(data);
}

export function writeManifest(projectDir: string, manifest: Manifest): void {
  const filePath = manifestPath(projectDir);
  const dir = path.dirname(filePath);
  const tmpPath = `${filePath}.tmp`;

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const sorted = sortKeys(manifest) as Manifest;
  const content = stableJsonStringify(sorted);
  writeFileSync(tmpPath, content, "utf8");
  renameSync(tmpPath, filePath);
}

export function getStarterVersion(): string {
  try {
    const raw = readFileSync(path.join(process.cwd(), "package.json"), "utf8");
    const pkg = JSON.parse(raw) as { version?: string };
    if (pkg.version) {
      return pkg.version;
    }
  } catch {
    // ignore
  }
  return "0.0.0";
}

export function createManifest(
  profile: string,
  features: string[],
  managedFiles: Record<string, ManifestFileEntry>,
): Manifest {
  const now = new Date().toISOString();
  let version = "0.10.1";
  try {
    const pkgPath = path.resolve("package.json");
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string };
      if (pkg.version) {
        version = pkg.version;
      }
    }
  } catch {
    // ignore
  }
  const sortedFeatures = [...features].sort();
  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    starter: {
      name: MANIFEST_NAME,
      version,
    },
    generation: {
      profile,
      features: sortedFeatures,
      createdAt: now,
      updatedAt: now,
    },
    managedFiles,
    appliedUpdates: [],
  };
}

export function readManifestOrLegacy(projectDir: string): Manifest | null {
  const filePath = manifestPath(projectDir);
  if (existsSync(filePath)) {
    return readManifest(projectDir);
  }
  const generatedPath = path.join(projectDir, "GENERATED.md");
  if (existsSync(generatedPath)) {
    console.warn(
      `⚠ No manifest found at ${filePath}; found legacy GENERATED.md. Run bun run generator:adopt -- --project=${projectDir} --baseline=<version> to migrate.`,
    );
  }
  return null;
}
