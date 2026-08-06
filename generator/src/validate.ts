import { FEATURES, getFeature } from "./features";
import { PROFILES } from "./profiles";

export type ValidationIssueKind =
  | "missing-requirement"
  | "conflict"
  | "unknown-feature"
  | "unknown-profile"
  | "duplicate-profile"
  | "ordering-violation"
  | "invalid-replacement"
  | "platform-incomplete"
  | "cycle";

export interface ValidationIssue {
  kind: ValidationIssueKind;
  feature: string;
  message: string;
}

const knownFeatures = new Set(FEATURES.map((feature) => feature.id));

export function validateFeatureSet(features: readonly string[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const seen = new Set<string>();

  for (const id of features) {
    if (!knownFeatures.has(id)) {
      issues.push({ kind: "unknown-feature", feature: id, message: `Unknown feature "${id}"` });
    }
  }

  for (const id of features) {
    if (seen.has(id)) {
      issues.push({ kind: "conflict", feature: id, message: `Duplicate feature "${id}"` });
    }
    seen.add(id);
  }

  for (const id of features) {
    if (!knownFeatures.has(id)) {
      continue;
    }
    const definition = getFeature(id);
    for (const requirement of definition.requires) {
      if (!features.includes(requirement)) {
        issues.push({
          kind: "missing-requirement",
          feature: id,
          message: `Feature "${id}" requires "${requirement}"`,
        });
      }
    }
  }

  for (const id of features) {
    if (!knownFeatures.has(id)) {
      continue;
    }
    const definition = getFeature(id);
    for (const excludedBy of definition.excludedBy) {
      if (features.includes(excludedBy)) {
        issues.push({
          kind: "conflict",
          feature: id,
          message: `Feature "${id}" cannot be combined with "${excludedBy}"`,
        });
      }
    }
  }

  return issues;
}

export function validateProfile(
  profileId: string,
): { features: string[] } | { errors: ValidationIssue[] } {
  const profile = PROFILES.find((candidate) => candidate.id === profileId);
  if (!profile) {
    return {
      errors: [
        { kind: "unknown-profile", feature: profileId, message: `Unknown profile "${profileId}"` },
      ],
    };
  }
  const issues = validateFeatureSet(profile.features);
  if (issues.length > 0) {
    return { errors: issues };
  }
  return { features: [...profile.features] };
}

const DEFERRED_FEATURES = new Set<string>(["dynamicRoles"]);

export function validateCatalog(): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const profileIds = new Set<string>();

  for (const profile of PROFILES) {
    if (profileIds.has(profile.id)) {
      issues.push({
        kind: "duplicate-profile",
        feature: profile.id,
        message: `Duplicate profile id "${profile.id}"`,
      });
    }
    profileIds.add(profile.id);
  }

  for (const profile of PROFILES) {
    const sorted = [...profile.features].sort();
    if (JSON.stringify(profile.features) !== JSON.stringify(sorted)) {
      issues.push({
        kind: "ordering-violation",
        feature: profile.id,
        message: `Profile "${profile.id}" features not deterministically sorted; expected [${sorted.join(", ")}]`,
      });
    }

    const featureIssues = validateFeatureSet(profile.features);
    for (const issue of featureIssues) {
      issues.push(issue);
    }

    if (profile.deprecated) {
      if (!profile.replacementProfiles || profile.replacementProfiles.length === 0) {
        issues.push({
          kind: "invalid-replacement",
          feature: profile.id,
          message: `Deprecated profile "${profile.id}" must list replacementProfiles`,
        });
      } else {
        for (const replacement of profile.replacementProfiles) {
          if (!profileIds.has(replacement)) {
            issues.push({
              kind: "unknown-profile",
              feature: replacement,
              message: `Unknown replacement profile "${replacement}" for "${profile.id}"`,
            });
          }
        }
      }
    } else if (profile.replacementProfiles && profile.replacementProfiles.length > 0) {
      issues.push({
        kind: "invalid-replacement",
        feature: profile.id,
        message: `Non-deprecated profile "${profile.id}" must not list replacementProfiles`,
      });
    }
  }

  // Cycle detection in feature requires graph
  const graph = new Map<string, readonly string[]>(
    FEATURES.map((feature) => [feature.id, feature.requires]),
  );
  const visiting = new Set<string>();
  const visited = new Set<string>();
  function dfs(node: string, stack: string[]): void {
    if (visiting.has(node)) {
      issues.push({
        kind: "cycle",
        feature: node,
        message: `Cycle detected: ${[...stack, node].join(" -> ")}`,
      });
      return;
    }
    if (visited.has(node)) {
      return;
    }
    visiting.add(node);
    const deps = graph.get(node) ?? [];
    for (const dep of deps) {
      dfs(dep, [...stack, node]);
    }
    visiting.delete(node);
    visited.add(node);
  }
  for (const feature of FEATURES) {
    dfs(feature.id, []);
  }

  // Platform completeness: must equal all non-deferred features
  const platform = PROFILES.find((candidate) => candidate.id === "platform");
  if (platform) {
    const allMinusDeferred = FEATURES.map((feature) => feature.id)
      .filter((id) => !DEFERRED_FEATURES.has(id))
      .sort();
    const platformSorted = [...platform.features].sort();
    if (JSON.stringify(platformSorted) !== JSON.stringify(allMinusDeferred)) {
      issues.push({
        kind: "platform-incomplete",
        feature: "platform",
        message: `platform must equal all features except deferred [${[...DEFERRED_FEATURES].join(", ")}]; expected [${allMinusDeferred.join(", ")}] got [${platformSorted.join(", ")}]`,
      });
    }
  }

  return issues;
}
