export type {
  AddFeatureFailure,
  AddFeatureIssue,
  AddFeatureIssueKind,
  AddFeatureOptions,
  AddFeatureResult,
  GeneratedManifest,
  ResourceApplicationResult,
  TenancyMigrationPlan,
} from "./add-feature";
export {
  addFeature,
  FeatureAdditionError,
  featurePlanFor,
  parseAddFeatureArgs,
  readGeneratedManifest,
  resolveFeatureClosure,
  TENANCY_MIGRATION_STEPS,
  updateGeneratedManifest,
} from "./add-feature";
export { GenerationError, UnknownFeatureError, UnknownProfileError } from "./errors";
export type { FeatureDefinition } from "./features";
export { FEATURES, getFeature } from "./features";
export type { JournalEntry, MigrationJournal } from "./migrations";
export {
  filterMigrationJournal,
  filterMigrationSnapshots,
  journalTagFor,
  snapshotNameFor,
} from "./migrations";
export type { ProjectPlan } from "./plan";
export {
  BASE_ENV_VARS,
  BASE_MIGRATIONS,
  BASE_MODULES,
  BASE_PACKAGES,
  PERSISTENCE_MODULES,
  planFeatureSet,
  planProject,
} from "./plan";
export type { ProfileDefinition } from "./profiles";
export { getProfile, PROFILES } from "./profiles";
export {
  computeKeepList,
  computeRemoveList,
  filterWorkspaceDependencies,
  rewriteAppPackageJson,
  rewriteConfigEnv,
  rewriteDrizzleConfig,
  rewriteEnvExample,
  rewriteRootPackageJson,
  rewriteTsconfig,
  rewriteWorkspaces,
} from "./prune";
export type { TemplateSelection } from "./templates";
export { selectTemplates } from "./templates";
export type { ValidationIssue, ValidationIssueKind } from "./validate";
export { validateFeatureSet, validateProfile } from "./validate";
