export const STARTER_VERSION = "0.10.1";

export interface UpdateContext {
  manifest: import("../src/manifest").Manifest;
  projectDir: string;
  canonicalDir: string;
}

export interface PlannedOperation {
  path: string;
  kind: "add" | "update" | "remove" | "manual";
  reason: string;
}

export interface Update {
  id: string;
  from: string;
  to: string;
  appliesTo?: string[];
  plan?: (context: UpdateContext) => PlannedOperation[];
  requiresManual?: string[];
  postValidations?: string[];
  reversible: boolean;
  breakingNotes?: string;
}

export const UPDATES: readonly Update[] = [
  {
    id: "0.10.1-to-0.11.0",
    from: "0.10.1",
    to: "0.11.0",
    appliesTo: [],
    reversible: true,
    breakingNotes:
      "Example update for granular profiles and manifest. No breaking changes for existing projects; multi-tenant remains deprecated.",
    plan: () => [],
  },
];

function parseSemVer(v: string): [number, number, number] {
  const parts = v.split(".").map((p) => Number.parseInt(p, 10));
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) {
    throw new Error(`invalid SemVer "${v}"`);
  }
  return parts as [number, number, number];
}

function compareSemVer(a: string, b: string): number {
  const [aMaj, aMin, aPat] = parseSemVer(a);
  const [bMaj, bMin, bPat] = parseSemVer(b);
  if (aMaj !== bMaj) {
    return aMaj - bMaj;
  }
  if (aMin !== bMin) {
    return aMin - bMin;
  }
  return aPat - bPat;
}

export function resolveUpdatePath(fromVersion: string, toVersion: string): Update[] {
  if (compareSemVer(fromVersion, toVersion) > 0) {
    throw new Error(`fromVersion ${fromVersion} is newer than toVersion ${toVersion}`);
  }
  if (fromVersion === toVersion) {
    return [];
  }
  const sorted = [...UPDATES].sort((a, b) => compareSemVer(a.from, b.from));
  const path: Update[] = [];
  let current = fromVersion;
  const seen = new Set<string>();

  while (compareSemVer(current, toVersion) < 0) {
    if (seen.has(current)) {
      throw new Error(`cycle detected in update registry at ${current}`);
    }
    seen.add(current);
    const next = sorted.find((u) => u.from === current);
    if (!next) {
      throw new Error(`no update path from ${current} to ${toVersion}: missing ${current} -> ...`);
    }
    if (compareSemVer(next.to, toVersion) > 0) {
      throw new Error(
        `no update path from ${fromVersion} to ${toVersion}: next update ${next.id} goes beyond target`,
      );
    }
    path.push(next);
    current = next.to;
  }

  if (current !== toVersion) {
    throw new Error(
      `no update path from ${fromVersion} to ${toVersion}: incomplete path, stopped at ${current}`,
    );
  }

  return path;
}
