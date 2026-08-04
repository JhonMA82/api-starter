import { UnknownFeatureError } from "./errors";

export interface FeatureDefinition {
  id: string;
  description: string;
  requires: readonly string[];
  excludedBy: readonly string[];
  modules: readonly string[];
  packages: readonly string[];
  migrations: readonly string[];
  envVars: readonly string[];
}

export const FEATURES: readonly FeatureDefinition[] = [
  {
    id: "persistence",
    description: "PostgreSQL, Drizzle, migrations, repositories, and transactions (spec §4.2)",
    requires: [],
    excludedBy: [],
    modules: [],
    packages: [],
    migrations: ["0000_jazzy_the_renegades.sql", "0001_magenta_tenebrous.sql"],
    envVars: ["DATABASE_URL"],
  },
  {
    id: "auth",
    description: "Better Auth users, sessions, access recovery, and email verification (spec §4.3)",
    requires: [],
    excludedBy: [],
    modules: [],
    packages: ["auth", "auth-client"],
    migrations: ["0002_chemical_karen_page.sql"],
    envVars: ["BETTER_AUTH_SECRET", "BETTER_AUTH_URL", "TRUSTED_ORIGINS"],
  },
  {
    id: "authorization",
    description: "Role-based and attribute-based access policies (spec §4.4)",
    requires: ["auth"],
    excludedBy: [],
    modules: [],
    packages: ["authorization"],
    migrations: [],
    envVars: [],
  },
  {
    id: "tenancy",
    description: "Organizations, memberships, and invitations (spec §4.4)",
    requires: ["auth"],
    excludedBy: [],
    modules: ["organizations"],
    packages: [],
    migrations: ["0004_rainy_living_mummy.sql"],
    envVars: [],
  },
  {
    id: "audit",
    description: "Append-only audit log with per-tenant integration (spec §4.4)",
    requires: ["persistence"],
    excludedBy: [],
    modules: [],
    packages: ["audit"],
    migrations: ["0003_careless_epoch.sql"],
    envVars: [],
  },
  {
    id: "apiKeys",
    description: "Organization-scoped API keys with hashed secrets (spec §4.4)",
    requires: ["tenancy"],
    excludedBy: [],
    modules: ["organizations"],
    packages: [],
    migrations: ["0007_api_keys.sql"],
    envVars: [],
  },
  {
    id: "jobs",
    description: "Persistent job queue and worker (spec §14.4)",
    requires: ["persistence"],
    excludedBy: [],
    modules: ["jobs"],
    packages: [],
    migrations: ["0006_sour_tinkerer.sql"],
    envVars: [],
  },
  {
    id: "webhooks",
    description:
      "Transactional outbox, outgoing and incoming webhooks with HMAC signatures (spec §14.3-14.6)",
    requires: ["tenancy", "jobs"],
    excludedBy: [],
    modules: ["organizations"],
    packages: [],
    migrations: ["0005_smooth_menace.sql", "0008_breezy_kronos.sql", "0009_boring_bloodscream.sql"],
    envVars: [],
  },
  {
    id: "files",
    description: "S3-backed file upload and download with signed URLs (spec §16)",
    requires: ["tenancy"],
    excludedBy: [],
    modules: ["files"],
    packages: [],
    migrations: ["0010_rainy_anthem.sql"],
    envVars: ["S3_ENDPOINT", "S3_BUCKET"],
  },
  {
    id: "notifications",
    description: "Email templates and asynchronous sending through the job queue (spec §16)",
    requires: ["jobs"],
    excludedBy: [],
    modules: ["notifications"],
    packages: [],
    migrations: ["0011_remarkable_yellowjacket.sql"],
    envVars: ["SMTP_URL"],
  },
  {
    id: "observability",
    description: "Logging, metrics, and tracing (spec §4.6)",
    requires: [],
    excludedBy: [],
    modules: [],
    packages: [],
    migrations: [],
    envVars: [],
  },
  {
    id: "dynamicRoles",
    description:
      "Data-driven per-organization roles (spec §18.1). DEFERRED: this repo only ships static role enums, so the generator rejects it next to static authorization",
    requires: ["tenancy"],
    excludedBy: ["authorization"],
    modules: [],
    packages: [],
    migrations: [],
    envVars: [],
  },
];

export function getFeature(id: string): FeatureDefinition {
  const feature = FEATURES.find((candidate) => candidate.id === id);
  if (!feature) {
    throw new UnknownFeatureError(id);
  }
  return feature;
}
