import { UnknownProfileError } from "./errors";

export interface ProfileDefinition {
  id: string;
  description: string;
  features: readonly string[];
}

export const PROFILES: readonly ProfileDefinition[] = [
  {
    id: "minimal",
    description: "Public APIs without persistence or user accounts (spec §4.1)",
    features: [],
  },
  {
    id: "data-api",
    description: "APIs with persistence but no user accounts (spec §4.2)",
    features: ["persistence"],
  },
  {
    id: "authenticated",
    description: "Single-tenant applications with user accounts (spec §4.3)",
    features: ["persistence", "auth", "authorization"],
  },
  {
    id: "multi-tenant",
    description: "One installation serving multiple organizations (spec §4.4)",
    features: [
      "persistence",
      "auth",
      "authorization",
      "tenancy",
      "audit",
      "apiKeys",
      "jobs",
      "webhooks",
      "files",
      "notifications",
    ],
  },
  {
    id: "platform",
    description: "All production capabilities, including observability (spec §4.6)",
    features: [
      "persistence",
      "auth",
      "authorization",
      "tenancy",
      "audit",
      "apiKeys",
      "jobs",
      "webhooks",
      "files",
      "notifications",
      "observability",
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
