import { FEATURES, getFeature } from "./features";
import { PROFILES } from "./profiles";

export type ValidationIssueKind =
  | "missing-requirement"
  | "conflict"
  | "unknown-feature"
  | "unknown-profile";

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
