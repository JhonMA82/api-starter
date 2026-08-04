import { describe, expect, test } from "bun:test";

import type { ApiClient } from "../src/client";
import {
  createBrowserApiClient,
  createNextFetch,
  createNextFetchPolicy,
  createNextQueryTag,
  createNextServerClient,
} from "../src/next";
import {
  createApiQueryKeys,
  createSdkMutationInvalidations,
  createSdkQueries,
  createSdkQueryKey,
  createSdkQueryOptions,
} from "../src/tanstack";

interface FetchCall {
  input: RequestInfo | URL;
  init: RequestInit | undefined;
}

type NextInit = RequestInit & {
  next?: {
    revalidate?: number;
    tags?: readonly string[];
  };
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function fakeFetch(): { calls: FetchCall[]; fetcher: typeof fetch } {
  const calls: FetchCall[] = [];
  const fetcher = (async (input, init) => {
    calls.push({ input, init: init as RequestInit | undefined });
    return jsonResponse({ ok: true });
  }) as typeof fetch;
  return { calls, fetcher };
}

function fakeQueryClient(): {
  client: ApiClient;
  calls: { kind: string; argument?: unknown }[];
} {
  const calls: { kind: string; argument?: unknown }[] = [];
  const client = {
    auth: {
      getSession: async () => {
        calls.push({ kind: "session" });
        return { user: null, session: null };
      },
    },
    organizations: {
      list: async () => {
        calls.push({ kind: "organizations" });
        return [];
      },
      context: async (organizationId: string) => {
        calls.push({ kind: "organizationContext", argument: organizationId });
        return {
          organizationId,
          membershipId: "membership-1",
          userId: "user-1",
          roleIds: ["member"],
        };
      },
    },
    files: {
      list: async (options?: { organizationId?: string; limit?: number }) => {
        calls.push({ kind: "files", argument: options });
        return { files: [] };
      },
    },
    webhooks: {
      list: async (organizationId: string) => {
        calls.push({ kind: "webhooks", argument: organizationId });
        return [];
      },
    },
    apiKeys: {
      list: async (organizationId: string) => {
        calls.push({ kind: "apiKeys", argument: organizationId });
        return [];
      },
    },
  } as unknown as ApiClient;
  return { client, calls };
}

describe("TanStack Query compatibility layer", () => {
  test("creates deterministic prefixed query keys", () => {
    expect(createSdkQueryKey("files", "org-1", 10)).toEqual([
      "@consulting/sdk",
      "files",
      "org-1",
      10,
    ]);
    expect(createSdkQueryKey("files", "org-1", 10)).toEqual(
      createSdkQueryKey("files", "org-1", 10),
    );
  });

  test("normalizes surrounding scope whitespace", () => {
    expect(createSdkQueryKey(" files ")).toEqual(["@consulting/sdk", "files"]);
  });

  test("rejects an empty query-key scope", () => {
    expect(() => createSdkQueryKey("  ")).toThrow("query key scope must not be empty");
  });

  test("rejects an empty query key and empty key scope", () => {
    expect(() => createSdkQueryOptions([], async () => null)).toThrow(
      "query key must not be empty",
    );
    expect(() => createSdkQueryOptions(["sdk", ""], async () => null)).toThrow(
      "query key scope must not be empty",
    );
  });

  test("forwards query options and keeps query functions lazy", async () => {
    let invoked = false;
    const queryFn = async () => {
      invoked = true;
      return 42;
    };
    const options = createSdkQueryOptions(createSdkQueryKey("session"), queryFn, {
      staleTime: 10_000,
      gcTime: 20_000,
      enabled: false,
    });

    expect(invoked).toBe(false);
    expect(options).toEqual({
      queryKey: ["@consulting/sdk", "session"],
      queryFn,
      staleTime: 10_000,
      gcTime: 20_000,
      enabled: false,
    });
    await expect(options.queryFn()).resolves.toBe(42);
    expect(invoked).toBe(true);
  });

  test("creates stable keys for every API query factory", () => {
    const keys = createApiQueryKeys();
    expect(keys.session()).toEqual(keys.session());
    expect(keys.organizations()).toEqual(keys.organizations());
    expect(keys.organizationContext("org-1")).toEqual([
      "@consulting/sdk",
      "organizationContext",
      "org-1",
    ]);
    expect(keys.files("org-1", 5)).toEqual(["@consulting/sdk", "files", "org-1", 5]);
    expect(keys.webhooks("org-1")).toEqual(["@consulting/sdk", "webhooks", "org-1"]);
    expect(keys.apiKeys("org-1")).toEqual(["@consulting/sdk", "apiKeys", "org-1"]);
  });

  test("does no resource work while creating SDK queries", () => {
    const { client, calls } = fakeQueryClient();
    createSdkQueries(client);
    expect(calls).toEqual([]);
  });

  test("runs the session query through auth", async () => {
    const { client, calls } = fakeQueryClient();
    const query = createSdkQueries(client).session();

    await expect(query.queryFn()).resolves.toEqual({ user: null, session: null });
    expect(calls).toEqual([{ kind: "session" }]);
  });

  test("runs the organizations query through the supplied list capability", async () => {
    const { client, calls } = fakeQueryClient();
    await createSdkQueries(client).organizations().queryFn();

    expect(calls).toEqual([{ kind: "organizations" }]);
  });

  test("runs organization context with its id", async () => {
    const { client, calls } = fakeQueryClient();
    await createSdkQueries(client).organizationContext("org/1").queryFn();

    expect(calls).toEqual([{ kind: "organizationContext", argument: "org/1" }]);
  });

  test("forwards file list options to the resource", async () => {
    const { client, calls } = fakeQueryClient();
    const options = { organizationId: "org-1", limit: 25 };
    const query = createSdkQueries(client).files(options);

    expect(query.queryKey).toEqual(["@consulting/sdk", "files", "org-1", 25]);
    await query.queryFn();
    expect(calls).toEqual([{ kind: "files", argument: options }]);
  });

  test("runs webhook and API-key organization queries", async () => {
    const { client, calls } = fakeQueryClient();
    await createSdkQueries(client).webhooks("org-1").queryFn();
    await createSdkQueries(client).apiKeys("org-1").queryFn();

    expect(calls).toEqual([
      { kind: "webhooks", argument: "org-1" },
      { kind: "apiKeys", argument: "org-1" },
    ]);
  });

  test("reports missing organization and API-key list capabilities", async () => {
    const client = {
      organizations: {},
      apiKeys: {},
    } as unknown as ApiClient;
    const queries = createSdkQueries(client);

    await expect(queries.organizations().queryFn()).rejects.toThrow(
      "SDK organizations resource must expose list() for this query",
    );
    await expect(queries.apiKeys("org-1").queryFn()).rejects.toThrow(
      "SDK apiKeys resource must expose list() for this query",
    );
  });

  test("describes invalidation prefixes for every mutation group", () => {
    const invalidations = createSdkMutationInvalidations();

    expect(invalidations.organizationCreation).toEqual([["@consulting/sdk", "organizations"]]);
    expect(invalidations.membershipInvitationChanges).toEqual([
      ["@consulting/sdk", "organizations"],
      ["@consulting/sdk", "organizationContext"],
    ]);
    expect(invalidations.fileMutations).toEqual([["@consulting/sdk", "files"]]);
    expect(invalidations.apiKeyMutations).toEqual([["@consulting/sdk", "apiKeys"]]);
    expect(invalidations.webhookMutations).toEqual([["@consulting/sdk", "webhooks"]]);
  });
});

describe("Next App Router compatibility layer", () => {
  test("defaults sensitive data to no-store", () => {
    expect(createNextFetchPolicy()).toEqual({ cache: "no-store" });
    expect(createNextFetchPolicy({ sensitive: true, tags: ["ignored"] })).toEqual({
      cache: "no-store",
    });
  });

  test("creates a force-cache policy for explicit public revalidation", () => {
    expect(createNextFetchPolicy({ sensitive: false, revalidate: 60 })).toEqual({
      cache: "force-cache",
      next: { revalidate: 60 },
    });
  });

  test("forwards tags in a public cache policy", () => {
    expect(createNextFetchPolicy({ sensitive: false, revalidate: 60, tags: ["catalog"] })).toEqual({
      cache: "force-cache",
      next: { revalidate: 60, tags: ["catalog"] },
    });
  });

  test("supports an explicitly public policy without revalidation", () => {
    expect(createNextFetchPolicy({ sensitive: false })).toEqual({ cache: "force-cache" });
  });

  test("rejects negative and non-integer revalidation", () => {
    expect(() => createNextFetchPolicy({ revalidate: -1 })).toThrow(
      "revalidate must be a non-negative integer",
    );
    expect(() => createNextFetchPolicy({ revalidate: 1.5 })).toThrow(
      "revalidate must be a non-negative integer",
    );
    expect(() => createNextFetchPolicy({ revalidate: Number.NaN })).toThrow(
      "revalidate must be a non-negative integer",
    );
  });

  test("applies the server no-store policy and forwards cookie, organization, and base URL", async () => {
    const { fetcher, calls } = fakeFetch();
    const client = createNextServerClient({
      baseUrl: "https://api.example.test/",
      cookieHeader: "session=abc",
      organizationId: "org-1",
      fetch: fetcher,
    });

    await client.auth.getSession();

    const call = calls[0];
    expect(String(call?.input)).toBe("https://api.example.test/api/auth/get-session");
    expect(call?.init?.credentials).toBe("include");
    expect(call?.init?.cache).toBe("no-store");
    expect(new Headers(call?.init?.headers).get("cookie")).toBe("session=abc");
    expect(new Headers(call?.init?.headers).get("x-organization-id")).toBe("org-1");
  });

  test("applies intentional server revalidation and tags", async () => {
    const { fetcher, calls } = fakeFetch();
    const client = createNextServerClient({
      baseUrl: "https://api.example.test",
      fetch: fetcher,
      revalidate: 30,
      tags: ["organizations"],
    });

    await client.auth.getSession();

    const init = calls[0]?.init as NextInit | undefined;
    expect(init?.cache).toBe("force-cache");
    expect(init?.next).toEqual({ revalidate: 30, tags: ["organizations"] });
  });

  test("preserves caller cache and next options in the fetch wrapper", async () => {
    const { fetcher, calls } = fakeFetch();
    const wrapped = createNextFetch(fetcher, {
      cache: "no-store",
      next: { revalidate: 60, tags: ["default"] },
    });
    const callerNext = { revalidate: 5, tags: ["caller"] } as const;
    const callerInit: NextInit = {
      cache: "reload",
      next: callerNext,
      headers: { "x-test": "present" },
    };

    await wrapped("https://api.example.test/resource", callerInit);

    const init = calls[0]?.init as NextInit | undefined;
    expect(init?.cache).toBe("reload");
    expect(init?.next).toBe(callerNext);
    expect(new Headers(init?.headers).get("x-test")).toBe("present");
  });

  test("adds the policy when caller cache and next options are absent", async () => {
    const { fetcher, calls } = fakeFetch();
    const wrapped = createNextFetch(fetcher, {
      cache: "force-cache",
      next: { revalidate: 10 },
    });

    await wrapped("https://api.example.test/resource");

    const init = calls[0]?.init as NextInit | undefined;
    expect(init?.cache).toBe("force-cache");
    expect(init?.next).toEqual({ revalidate: 10 });
  });

  test("browser client includes credentials and invokes the token getter", async () => {
    const { fetcher, calls } = fakeFetch();
    let tokenReads = 0;
    const client = createBrowserApiClient({
      baseUrl: "https://api.example.test",
      fetch: fetcher,
      getAccessToken: () => {
        tokenReads += 1;
        return "browser-token";
      },
    });

    await client.auth.getSession();

    expect(tokenReads).toBe(1);
    expect(calls[0]?.init?.credentials).toBe("include");
    expect(new Headers(calls[0]?.init?.headers).get("authorization")).toBe("Bearer browser-token");
  });

  test("creates stable tags from the SDK key format", () => {
    const tag = createNextQueryTag("files", "org-1", 10);
    expect(tag).toBe(JSON.stringify(["@consulting/sdk", "files", "org-1", 10]));
    expect(tag).toBe(createNextQueryTag("files", "org-1", 10));
    expect(tag).not.toBe(createNextQueryTag("files", "org-2", 10));
  });
});
