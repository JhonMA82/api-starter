import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { FEATURES } from "./features";
import { PROFILES } from "./profiles";

export function serializeFeaturesManifest(): unknown {
  return FEATURES;
}

export function serializeProfilesManifest(): unknown {
  return PROFILES;
}

const LINE_WIDTH = 80;

/**
 * Serializes the catalog the way Biome formats JSON: two-space indent and
 * arrays/objects collapse to a single line when they fit within the line
 * width, otherwise they print one element per line. Keeps the committed
 * manifests drift-free against `biome check` (see catalog.test.ts).
 */
export function serializeBiomeJson(value: unknown, indent = 0): string {
  const pad = (level: number): string => "  ".repeat(level);
  const prefix = pad(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return "[]";
    }
    const inline = `[${value.map((item) => serializeBiomeJson(item, 0)).join(", ")}]`;
    if (prefix.length + inline.length <= LINE_WIDTH) {
      return inline;
    }
    const items = value.map((item) => `${pad(indent + 1)}${serializeBiomeJson(item, indent + 1)}`);
    return `[\n${items.join(",\n")}\n${prefix}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      return "{}";
    }
    const inline = `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}: ${serializeBiomeJson(item, 0)}`)
      .join(", ")}}`;
    if (prefix.length + inline.length <= LINE_WIDTH) {
      return inline;
    }
    const items = entries.map(
      ([key, item]) =>
        `${pad(indent + 1)}${JSON.stringify(key)}: ${serializeBiomeJson(item, indent + 1)}`,
    );
    return `{\n${items.join(",\n")}\n${prefix}}`;
  }
  return JSON.stringify(value);
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${serializeBiomeJson(value)}\n`);
}

export function writeManifests(): void {
  writeJson(
    fileURLToPath(new URL("../features.json", import.meta.url)),
    serializeFeaturesManifest(),
  );
  writeJson(
    fileURLToPath(new URL("../profiles.json", import.meta.url)),
    serializeProfilesManifest(),
  );
}

if (import.meta.main) {
  writeManifests();
  console.log("generator: wrote features.json and profiles.json");
}
