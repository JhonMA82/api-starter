import type { ApiClient } from "./client";
import type {
  ApiKey,
  AuthSessionResult,
  ListFilesOptions,
  ListFilesResult,
  Organization,
  OrganizationContext,
  WebhookEndpoint,
} from "./types";

const SDK_QUERY_KEY_PREFIX = "@consulting/sdk";

export type TanStackQueryKey = readonly unknown[];

export interface SdkQueryOptions<TData> {
  queryKey: TanStackQueryKey;
  queryFn: () => Promise<TData>;
  staleTime?: number;
  gcTime?: number;
  enabled?: boolean;
}

export interface SdkQueryOptionOverrides {
  staleTime?: number;
  gcTime?: number;
  enabled?: boolean;
}

export interface ApiQueryKeys {
  session(): TanStackQueryKey;
  organizations(): TanStackQueryKey;
  organizationContext(organizationId: string): TanStackQueryKey;
  files(organizationId?: string, limit?: number): TanStackQueryKey;
  webhooks(organizationId: string): TanStackQueryKey;
  apiKeys(organizationId: string): TanStackQueryKey;
}

export interface SdkQueries {
  session(): SdkQueryOptions<AuthSessionResult>;
  organizations(): SdkQueryOptions<Organization[]>;
  organizationContext(organizationId: string): SdkQueryOptions<OrganizationContext>;
  files(options?: ListFilesOptions): SdkQueryOptions<ListFilesResult>;
  webhooks(organizationId: string): SdkQueryOptions<WebhookEndpoint[]>;
  apiKeys(organizationId: string): SdkQueryOptions<ApiKey[]>;
}

export interface SdkMutationInvalidations {
  organizationCreation: readonly TanStackQueryKey[];
  membershipInvitationChanges: readonly TanStackQueryKey[];
  fileMutations: readonly TanStackQueryKey[];
  apiKeyMutations: readonly TanStackQueryKey[];
  webhookMutations: readonly TanStackQueryKey[];
}

function assertNonEmptyScope(scope: string): string {
  const normalizedScope = scope.trim();
  if (normalizedScope === "") {
    throw new TypeError("query key scope must not be empty");
  }
  return normalizedScope;
}

function assertQueryKey(queryKey: TanStackQueryKey): void {
  if (queryKey.length === 0) {
    throw new TypeError("query key must not be empty");
  }

  for (const part of queryKey.slice(0, 2)) {
    if (typeof part === "string" && part.trim() === "") {
      throw new TypeError("query key scope must not be empty");
    }
  }
}

export function createSdkQueryKey(scope: string, ...parts: readonly unknown[]): TanStackQueryKey {
  return Object.freeze([SDK_QUERY_KEY_PREFIX, assertNonEmptyScope(scope), ...parts]);
}

export function createSdkQueryOptions<TData>(
  queryKey: TanStackQueryKey,
  queryFn: () => Promise<TData>,
  options: SdkQueryOptionOverrides = {},
): SdkQueryOptions<TData> {
  assertQueryKey(queryKey);
  return { queryKey, queryFn, ...options };
}

export function createApiQueryKeys(): ApiQueryKeys {
  return {
    session: () => createSdkQueryKey("session"),
    organizations: () => createSdkQueryKey("organizations"),
    organizationContext: (organizationId) =>
      createSdkQueryKey("organizationContext", organizationId),
    files: (organizationId, limit) => createSdkQueryKey("files", organizationId, limit),
    webhooks: (organizationId) => createSdkQueryKey("webhooks", organizationId),
    apiKeys: (organizationId) => createSdkQueryKey("apiKeys", organizationId),
  };
}

type ListableResource<TData> = {
  list?: () => Promise<TData>;
};

type ListableApiKeysResource = {
  list?: (organizationId: string) => Promise<ApiKey[]>;
};

async function callList<TData>(
  resource: ListableResource<TData>,
  resourceName: string,
): Promise<TData> {
  const list = resource.list;
  if (typeof list !== "function") {
    throw new TypeError(`SDK ${resourceName} resource must expose list() for this query`);
  }
  return list.call(resource);
}

export function createSdkQueries(client: ApiClient): SdkQueries {
  const keys = createApiQueryKeys();
  // The current SDK core has no list methods for these two resources. Keep the
  // adapter extensible for clients that expose the corresponding REST reads.
  const organizations = client.organizations as ApiClient["organizations"] &
    ListableResource<Organization[]>;
  const apiKeys = client.apiKeys as ApiClient["apiKeys"] & ListableApiKeysResource;

  return {
    session: () =>
      createSdkQueryOptions(keys.session(), () => client.auth.getSession<AuthSessionResult>()),
    organizations: () =>
      createSdkQueryOptions(keys.organizations(), () => callList(organizations, "organizations")),
    organizationContext: (organizationId) =>
      createSdkQueryOptions(keys.organizationContext(organizationId), () =>
        client.organizations.context(organizationId),
      ),
    files: (options) =>
      createSdkQueryOptions(keys.files(options?.organizationId, options?.limit), () =>
        client.files.list(options),
      ),
    webhooks: (organizationId) =>
      createSdkQueryOptions(keys.webhooks(organizationId), () =>
        client.webhooks.list(organizationId),
      ),
    apiKeys: (organizationId) =>
      createSdkQueryOptions(keys.apiKeys(organizationId), async () => {
        const list = apiKeys.list;
        if (typeof list !== "function") {
          throw new TypeError("SDK apiKeys resource must expose list() for this query");
        }
        return list.call(apiKeys, organizationId);
      }),
  };
}

export function createSdkMutationInvalidations(): SdkMutationInvalidations {
  const keys = createApiQueryKeys();
  return {
    organizationCreation: [keys.organizations()],
    membershipInvitationChanges: [keys.organizations(), createSdkQueryKey("organizationContext")],
    fileMutations: [createSdkQueryKey("files")],
    apiKeyMutations: [createSdkQueryKey("apiKeys")],
    webhookMutations: [createSdkQueryKey("webhooks")],
  };
}
