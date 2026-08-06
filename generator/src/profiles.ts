import { UnknownProfileError } from "./errors";

export interface ProfileDefinition {
  id: string;
  description: string;
  features: readonly string[];
  deprecated?: boolean;
  deprecatedReason?: string;
  replacementProfiles?: readonly string[];
}

export const PROFILES: readonly ProfileDefinition[] = [
  {
    id: "authenticated",
    description: "Single-tenant applications with user accounts (spec §4.3)",
    features: ["auth", "authorization", "persistence"],
  },
  {
    id: "data-api",
    description: "APIs with persistence but no user accounts (spec §4.2)",
    features: ["persistence"],
  },
  {
    id: "integration-platform",
    description: "Platform integrating external systems with async processing (spec §4.5)",
    features: [
      "apiKeys",
      "audit",
      "auth",
      "authorization",
      "jobs",
      "persistence",
      "tenancy",
      "webhooks",
    ],
  },
  {
    id: "minimal",
    description: "Public APIs without persistence or user accounts (spec §4.1)",
    features: [],
  },
  {
    id: "multi-tenant",
    description:
      "One installation serving multiple organizations — deprecated, use multi-tenant-core/integration-platform/platform (spec §4.4 legacy)",
    features: [
      "apiKeys",
      "audit",
      "auth",
      "authorization",
      "files",
      "jobs",
      "notifications",
      "persistence",
      "tenancy",
      "webhooks",
    ],
    deprecated: true,
    deprecatedReason:
      "Use multi-tenant-core, integration-platform, or platform. Will be reconsidered for removal in 0.11.0.",
    replacementProfiles: ["multi-tenant-core", "integration-platform", "platform"],
  },
  {
    id: "multi-tenant-core",
    description: "SaaS multi-tenant core without integrations (spec §4.4 core)",
    features: ["audit", "auth", "authorization", "persistence", "tenancy"],
  },
  {
    id: "platform",
    description: "All production capabilities, including observability (spec §4.6)",
    features: [
      "apiKeys",
      "audit",
      "auth",
      "authorization",
      "files",
      "jobs",
      "notifications",
      "observability",
      "persistence",
      "tenancy",
      "webhooks",
    ],
  },
];

export function getProfile(id: string): ProfileDefinition {
  const profile = PROFILES.find((candidate) => candidate.id === id);
  if (!profile) {
    throw new UnknownProfileError(id);
  }
  return profile;
}
