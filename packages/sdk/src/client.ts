import { type ApiClientOptions, type ApiTransport, createTransport } from "./transport";
import type {
  AcceptInvitationInput,
  AuthSessionResult,
  CreateApiKeyInput,
  CreateApiKeyResult,
  CreateDownloadUrlOptions,
  CreateDownloadUrlResult,
  CreateOrganizationInput,
  DeleteOrganizationInput,
  FileResource,
  InviteMemberInput,
  InviteMemberResult,
  ListFilesOptions,
  ListFilesResult,
  Membership,
  Organization,
  OrganizationContext,
  RegisterWebhookInput,
  RegisterWebhookResult,
  RotateWebhookResult,
  TenantRequestOptions,
  ToggleWebhookInput,
  TransferOwnershipInput,
  TransferOwnershipResult,
  UploadFileResult,
  WebhookDelivery,
  WebhookEndpoint,
} from "./types";

export interface AuthResource {
  getSession<T = AuthSessionResult>(): Promise<T>;
}

export interface OrganizationsResource {
  create(input: CreateOrganizationInput): Promise<Organization>;
  context(organizationId: string): Promise<OrganizationContext>;
  invite(organizationId: string, input: InviteMemberInput): Promise<InviteMemberResult>;
  acceptInvitation(input: AcceptInvitationInput): Promise<Membership>;
  transferOwnership(
    organizationId: string,
    input: TransferOwnershipInput,
  ): Promise<TransferOwnershipResult>;
  suspend(organizationId: string): Promise<Organization>;
  removeMember(organizationId: string, userId: string): Promise<void>;
  delete(organizationId: string, input: DeleteOrganizationInput): Promise<void>;
}

export interface ApiKeysResource {
  create(organizationId: string, input: CreateApiKeyInput): Promise<CreateApiKeyResult>;
  revoke(organizationId: string, keyId: string): Promise<void>;
}

export interface FilesResource {
  upload(formData: FormData, options?: TenantRequestOptions): Promise<UploadFileResult>;
  list(options?: ListFilesOptions): Promise<ListFilesResult>;
  get(fileId: string, options?: TenantRequestOptions): Promise<FileResource>;
  delete(fileId: string, options?: TenantRequestOptions): Promise<void>;
  createDownloadUrl(
    fileId: string,
    options?: CreateDownloadUrlOptions,
  ): Promise<CreateDownloadUrlResult>;
}

export interface WebhooksResource {
  create(organizationId: string, input: RegisterWebhookInput): Promise<RegisterWebhookResult>;
  list(organizationId: string): Promise<WebhookEndpoint[]>;
  rotate(organizationId: string, webhookId: string): Promise<RotateWebhookResult>;
  toggle(
    organizationId: string,
    webhookId: string,
    input: ToggleWebhookInput,
  ): Promise<WebhookEndpoint>;
  deliveries(organizationId: string, webhookId: string, limit?: number): Promise<WebhookDelivery[]>;
}

export interface ApiClient {
  auth: AuthResource;
  organizations: OrganizationsResource;
  apiKeys: ApiKeysResource;
  files: FilesResource;
  webhooks: WebhooksResource;
}

function pathId(value: string): string {
  return encodeURIComponent(value);
}

function withQuery(
  path: string,
  values: Record<string, string | number | boolean | undefined>,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) {
      params.set(key, String(value));
    }
  }
  const query = params.toString();
  return query === "" ? path : `${path}?${query}`;
}

async function requiredBody<T>(result: Promise<T | undefined>): Promise<T> {
  const body = await result;
  if (body === undefined) {
    throw new Error("API returned an empty response body");
  }
  return body;
}

async function noContent(result: Promise<unknown | undefined>): Promise<void> {
  await result;
}

function tenantInit(organizationId: string | undefined): TenantRequestOptions {
  return organizationId === undefined ? {} : { organizationId };
}

function createAuthResource(transport: ApiTransport): AuthResource {
  async function getSession<T = AuthSessionResult>(): Promise<T> {
    return requiredBody(transport.json<T>("/api/auth/get-session"));
  }
  return { getSession };
}

function createOrganizationsResource(transport: ApiTransport): OrganizationsResource {
  return {
    create: (input) =>
      requiredBody(
        transport.json<Organization>("/api/v1/organizations", {
          method: "POST",
          body: input,
        }),
      ),
    context: (organizationId) =>
      requiredBody(
        transport.request<OrganizationContext>(`/api/v1/organizations/${pathId(organizationId)}`, {
          organizationId,
        }),
      ),
    invite: (organizationId, input) =>
      requiredBody(
        transport.json<InviteMemberResult>(
          `/api/v1/organizations/${pathId(organizationId)}/invitations`,
          { method: "POST", body: input, organizationId },
        ),
      ),
    acceptInvitation: (input) =>
      requiredBody(
        transport.json<Membership>("/api/v1/organizations/accept-invitation", {
          method: "POST",
          body: input,
        }),
      ),
    transferOwnership: (organizationId, input) =>
      requiredBody(
        transport.json<TransferOwnershipResult>(
          `/api/v1/organizations/${pathId(organizationId)}/ownership`,
          { method: "POST", body: input, organizationId },
        ),
      ),
    suspend: (organizationId) =>
      requiredBody(
        transport.json<Organization>(`/api/v1/organizations/${pathId(organizationId)}/suspend`, {
          method: "POST",
          organizationId,
        }),
      ),
    removeMember: (organizationId, userId) =>
      noContent(
        transport.request(
          `/api/v1/organizations/${pathId(organizationId)}/members/${pathId(userId)}`,
          { method: "DELETE", organizationId },
        ),
      ),
    delete: (organizationId, input) =>
      noContent(
        transport.request(
          withQuery(`/api/v1/organizations/${pathId(organizationId)}`, {
            confirm: input.confirm,
          }),
          { method: "DELETE", organizationId },
        ),
      ),
  };
}

function createApiKeysResource(transport: ApiTransport): ApiKeysResource {
  return {
    create: (organizationId, input) =>
      requiredBody(
        transport.json<CreateApiKeyResult>(
          `/api/v1/organizations/${pathId(organizationId)}/api-keys`,
          { method: "POST", body: input, organizationId },
        ),
      ),
    revoke: (organizationId, keyId) =>
      noContent(
        transport.request(
          `/api/v1/organizations/${pathId(organizationId)}/api-keys/${pathId(keyId)}`,
          { method: "DELETE", organizationId },
        ),
      ),
  };
}

function createFilesResource(transport: ApiTransport): FilesResource {
  return {
    upload: (formData, options = {}) =>
      requiredBody(
        transport.form<UploadFileResult>("/api/v1/files", formData, {
          method: "POST",
          ...tenantInit(options.organizationId),
        }),
      ),
    list: (options = {}) =>
      requiredBody(
        transport.request<ListFilesResult>(
          withQuery("/api/v1/files", { limit: options.limit }),
          tenantInit(options.organizationId),
        ),
      ),
    get: (fileId, options = {}) =>
      requiredBody(
        transport.request<FileResource>(`/api/v1/files/${pathId(fileId)}`, {
          ...tenantInit(options.organizationId),
        }),
      ),
    delete: (fileId, options = {}) =>
      noContent(
        transport.request(`/api/v1/files/${pathId(fileId)}`, {
          method: "DELETE",
          ...tenantInit(options.organizationId),
        }),
      ),
    createDownloadUrl: (fileId, options = {}) => {
      const { organizationId, expiresInSeconds } = options;
      return requiredBody(
        transport.json<CreateDownloadUrlResult>(`/api/v1/files/${pathId(fileId)}/url`, {
          method: "POST",
          body: { ...(expiresInSeconds === undefined ? {} : { expiresInSeconds }) },
          ...tenantInit(organizationId),
        }),
      );
    },
  };
}

function createWebhooksResource(transport: ApiTransport): WebhooksResource {
  return {
    create: (organizationId, input) =>
      requiredBody(
        transport.json<RegisterWebhookResult>(
          `/api/v1/organizations/${pathId(organizationId)}/webhooks`,
          { method: "POST", body: input, organizationId },
        ),
      ),
    list: (organizationId) =>
      requiredBody(
        transport.request<WebhookEndpoint[]>(
          `/api/v1/organizations/${pathId(organizationId)}/webhooks`,
          { organizationId },
        ),
      ),
    rotate: (organizationId, webhookId) =>
      requiredBody(
        transport.request<RotateWebhookResult>(
          `/api/v1/organizations/${pathId(organizationId)}/webhooks/${pathId(webhookId)}/rotate`,
          { method: "POST", organizationId },
        ),
      ),
    toggle: (organizationId, webhookId, input) =>
      requiredBody(
        transport.json<WebhookEndpoint>(
          `/api/v1/organizations/${pathId(organizationId)}/webhooks/${pathId(webhookId)}/toggle`,
          { method: "POST", body: input, organizationId },
        ),
      ),
    deliveries: (organizationId, webhookId, limit) =>
      requiredBody(
        transport.request<WebhookDelivery[]>(
          withQuery(
            `/api/v1/organizations/${pathId(organizationId)}/webhooks/${pathId(webhookId)}/deliveries`,
            { limit },
          ),
          { organizationId },
        ),
      ),
  };
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const transport = createTransport(options);
  return {
    auth: createAuthResource(transport),
    organizations: createOrganizationsResource(transport),
    apiKeys: createApiKeysResource(transport),
    files: createFilesResource(transport),
    webhooks: createWebhooksResource(transport),
  };
}
