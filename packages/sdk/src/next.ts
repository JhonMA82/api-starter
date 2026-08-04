import { type ApiClient, createApiClient } from "./client";
import { createSdkQueryKey } from "./tanstack";
import type { AccessTokenGetter, ApiClientOptions, OrganizationIdGetter } from "./transport";

export type NextCachePolicy = {
  cache: "no-store" | "force-cache";
  next?: {
    revalidate?: number;
    tags?: readonly string[];
  };
};

export interface NextFetchPolicyOptions {
  revalidate?: number;
  tags?: readonly string[];
  sensitive?: boolean;
}

export interface NextServerClientOptions {
  baseUrl: string;
  cookieHeader?: string;
  organizationId?: string;
  fetch?: typeof fetch;
  revalidate?: number;
  tags?: readonly string[];
}

export interface BrowserApiClientOptions {
  baseUrl: string;
  fetch?: typeof fetch;
  getAccessToken?: AccessTokenGetter;
  getOrganizationId?: OrganizationIdGetter;
}

type NextRequestInit = RequestInit & {
  next?: NextCachePolicy["next"];
};

function assertValidRevalidate(revalidate: number | undefined): void {
  if (revalidate !== undefined && (!Number.isInteger(revalidate) || revalidate < 0)) {
    throw new TypeError("revalidate must be a non-negative integer");
  }
}

export function createNextFetchPolicy(options: NextFetchPolicyOptions = {}): NextCachePolicy {
  assertValidRevalidate(options.revalidate);
  if (options.sensitive !== false) {
    return { cache: "no-store" };
  }
  if (options.revalidate === undefined && options.tags === undefined) {
    return { cache: "force-cache" };
  }

  const next: NonNullable<NextCachePolicy["next"]> = {};
  if (options.revalidate !== undefined) {
    next.revalidate = options.revalidate;
  }
  if (options.tags !== undefined) {
    next.tags = options.tags;
  }
  return { cache: "force-cache", next };
}

function hasOwn(value: object, property: PropertyKey): boolean {
  return Object.hasOwn(value, property);
}

export function createNextFetch(fetchImpl: typeof fetch, policy: NextCachePolicy): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const callerInit = init as NextRequestInit | undefined;
    const mergedInit: NextRequestInit = { ...(callerInit ?? {}) };
    if (callerInit === undefined || !hasOwn(callerInit, "cache")) {
      mergedInit.cache = policy.cache;
    }
    if (policy.next !== undefined && (callerInit === undefined || !hasOwn(callerInit, "next"))) {
      mergedInit.next = policy.next;
    }
    return fetchImpl(input, mergedInit);
  }) as typeof fetch;
}

function resolveFetch(fetchImpl: typeof fetch | undefined): typeof fetch {
  const resolvedFetch = fetchImpl ?? globalThis.fetch;
  if (typeof resolvedFetch !== "function") {
    throw new TypeError("a standard fetch implementation is required");
  }
  return resolvedFetch;
}

export function createNextServerClient(options: NextServerClientOptions): ApiClient {
  const policyOptions: NextFetchPolicyOptions = {
    sensitive: options.revalidate === undefined,
  };
  if (options.revalidate !== undefined) {
    policyOptions.revalidate = options.revalidate;
  }
  if (options.tags !== undefined) {
    policyOptions.tags = options.tags;
  }

  const clientOptions: ApiClientOptions = {
    baseUrl: options.baseUrl,
    credentials: "include",
    fetch: createNextFetch(resolveFetch(options.fetch), createNextFetchPolicy(policyOptions)),
  };
  if (options.cookieHeader !== undefined) {
    clientOptions.headers = { Cookie: options.cookieHeader };
  }
  if (options.organizationId !== undefined) {
    const organizationId = options.organizationId;
    clientOptions.getOrganizationId = () => organizationId;
  }
  return createApiClient(clientOptions);
}

export function createBrowserApiClient(options: BrowserApiClientOptions): ApiClient {
  const clientOptions: ApiClientOptions = {
    baseUrl: options.baseUrl,
    credentials: "include",
  };
  if (options.fetch !== undefined) {
    clientOptions.fetch = options.fetch;
  }
  if (options.getAccessToken !== undefined) {
    clientOptions.getAccessToken = options.getAccessToken;
  }
  if (options.getOrganizationId !== undefined) {
    clientOptions.getOrganizationId = options.getOrganizationId;
  }
  return createApiClient(clientOptions);
}

export function createNextQueryTag(scope: string, ...parts: readonly unknown[]): string {
  return JSON.stringify(createSdkQueryKey(scope, ...parts));
}
