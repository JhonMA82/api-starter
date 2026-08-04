export interface ProblemFieldError {
  field: string;
  message: string;
}

/** RFC 9457 fields plus the API's stable error extensions. */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
}

/** Normalized problem payload returned by the API on failed requests. */
export interface ApiErrorShape extends ProblemDetails {
  code: string;
  requestId: string;
  errors?: readonly ProblemFieldError[];
}

export type OrganizationRole = "owner" | "admin" | "auditor" | "member";
export type OrganizationStatus = "active" | "suspended";
export type MembershipStatus = "active" | "inactive";

export interface User {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  createdAt: string;
  updatedAt: string;
  metadata?: unknown;
}

export interface Session {
  id: string;
  userId: string;
  expiresAt: string;
  token?: string;
  createdAt?: string;
  updatedAt?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: unknown;
}

export interface AuthSessionResult {
  user: User | null;
  session: Session | null;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  status: OrganizationStatus;
  createdAt: string;
  updatedAt: string;
  metadata?: unknown;
}

export interface Membership {
  id: string;
  organizationId: string;
  userId: string;
  role: OrganizationRole;
  status: MembershipStatus;
  createdAt: string;
  updatedAt: string;
  metadata?: unknown;
}

export interface Invitation {
  id: string;
  organizationId: string;
  email: string;
  role: OrganizationRole;
  expiresAt: string;
  createdAt: string;
  metadata?: unknown;
}

export interface OrganizationContext {
  organizationId: string;
  membershipId: string;
  userId: string;
  roleIds: string[];
}

export interface ApiKey {
  id: string;
  organizationId: string;
  name: string;
  prefix: string;
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  metadata?: unknown;
}

export interface FileResource {
  id: string;
  organizationId: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  status: "stored" | "deleted";
  createdAt: string;
  deletedAt: string | null;
  downloadUrl?: string;
  metadata?: unknown;
}

export interface WebhookEndpoint {
  id: string;
  organizationId: string;
  url: string;
  events: string[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
  metadata?: unknown;
}

export interface WebhookDelivery {
  id: string;
  endpointId: string;
  eventId: string;
  payload: Record<string, unknown>;
  status: "pending" | "succeeded" | "failed";
  attempts: number;
  lastStatusCode: number | null;
  lastError: string | null;
  nextAttemptAt: string;
  createdAt: string;
  updatedAt: string;
  metadata?: unknown;
}

export interface CreateOrganizationInput {
  name: string;
  slug: string;
}

export interface InviteMemberInput {
  email: string;
  role: Exclude<OrganizationRole, "owner">;
}

export interface InviteMemberResult {
  invitation: Invitation;
  token: string;
}

export interface AcceptInvitationInput {
  token: string;
}

export interface TransferOwnershipInput {
  newOwnerUserId: string;
}

export interface TransferOwnershipResult {
  previousOwner: Membership;
  newOwner: Membership;
}

export interface DeleteOrganizationInput {
  confirm: boolean;
}

export interface CreateApiKeyInput {
  name: string;
  expiresAt?: string;
}

export interface CreateApiKeyResult {
  apiKey: ApiKey;
  secret: string;
}

export interface UploadFileResult {
  file: FileResource;
  downloadUrl: string;
  expiresIn: number;
}

export interface ListFilesInput {
  limit?: number;
}

export interface ListFilesResult {
  files: FileResource[];
}

export interface CreateDownloadUrlInput {
  expiresInSeconds?: number;
}

export interface CreateDownloadUrlResult {
  downloadUrl: string;
  expiresIn: number;
}

export interface RegisterWebhookInput {
  url: string;
  events?: readonly string[];
}

export interface RegisterWebhookResult {
  endpoint: WebhookEndpoint;
  secret: string;
}

export interface RotateWebhookResult {
  endpoint: WebhookEndpoint;
  secret: string;
}

export interface ToggleWebhookInput {
  active: boolean;
}

export interface TenantRequestOptions {
  /** Overrides the transport's current organization for this request only. */
  organizationId?: string;
}

export interface ListFilesOptions extends ListFilesInput, TenantRequestOptions {}

export interface CreateDownloadUrlOptions extends CreateDownloadUrlInput, TenantRequestOptions {}
