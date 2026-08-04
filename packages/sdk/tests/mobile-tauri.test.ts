import { describe, expect, test } from "bun:test";

import {
  computeRetryDelay,
  createIdempotencyKey,
  createInMemoryOfflineMutationStore,
  createMobileApiClient,
  createMobileSession,
  createMobileUploadForm,
  createOfflineMutationRunner,
  createTauriApiClient,
  createTauriCredentialBridge,
  createTauriSystemAuth,
  DEFAULT_TAURI_CREDENTIAL_COMMANDS,
  type MobileTokens,
  type OfflineMutation,
  type SecureTokenStore,
  shouldRetry,
  type TauriInvoke,
  withIdempotencyKey,
} from "../src/index";

interface FetchCall {
  input: RequestInfo | URL;
  init: RequestInit | undefined;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function createFakeFetch(response: Response = jsonResponse({ ok: true })) {
  const calls: FetchCall[] = [];
  const fetcher = (async (input, init) => {
    calls.push({ input, init: init as RequestInit | undefined });
    return response;
  }) as typeof fetch;
  return { calls, fetcher };
}

function createTokenStore(initial: MobileTokens | null) {
  let tokens = initial;
  const store: SecureTokenStore = {
    get: async () => (tokens === null ? null : { ...tokens }),
    set: async (next) => {
      tokens = { ...next };
    },
    clear: async () => {
      tokens = null;
    },
  };
  return { store, current: () => tokens };
}

function mutation(
  idempotencyKey: string,
  nextAttemptAt = 0,
  attempts = 0,
): OfflineMutation<{ value: string }> {
  return {
    idempotencyKey,
    path: "/api/v1/items",
    method: "POST",
    payload: { value: idempotencyKey },
    createdAt: 0,
    attempts,
    nextAttemptAt,
  };
}

describe("mobile session and client", () => {
  test("saves, reads, and clears secure tokens", async () => {
    const { store, current } = createTokenStore(null);
    const session = createMobileSession({ store });
    const tokens = { accessToken: "access-1", refreshToken: "refresh-1" };

    await session.save(tokens);
    await expect(session.getTokens()).resolves.toEqual(tokens);
    await expect(session.getAccessToken()).resolves.toBe("access-1");
    await session.clear();

    expect(current()).toBeNull();
    await expect(session.getAccessToken()).resolves.toBeUndefined();
  });

  test("refreshes and persists the returned token pair", async () => {
    const { store, current } = createTokenStore({
      accessToken: "old-access",
      refreshToken: "old-refresh",
    });
    const refreshed: MobileTokens = { accessToken: "new-access", refreshToken: "new-refresh" };
    let receivedRefreshToken: string | undefined;
    const session = createMobileSession({
      store,
      refresh: async (refreshToken) => {
        receivedRefreshToken = refreshToken;
        return refreshed;
      },
    });

    await expect(session.refresh()).resolves.toEqual(refreshed);
    expect(receivedRefreshToken).toBe("old-refresh");
    expect(current()).toEqual(refreshed);
  });

  test("shares one in-flight refresh promise between concurrent callers", async () => {
    const { store } = createTokenStore({ accessToken: "old", refreshToken: "refresh" });
    let refreshCalls = 0;
    let resolveRefresh: ((tokens: MobileTokens) => void) | undefined;
    const session = createMobileSession({
      store,
      refresh: async () => {
        refreshCalls += 1;
        return new Promise<MobileTokens>((resolve) => {
          resolveRefresh = resolve;
        });
      },
    });

    const first = session.refresh();
    const second = session.refresh();
    expect(second).toBe(first);
    await Promise.resolve();
    expect(refreshCalls).toBe(1);
    resolveRefresh?.({ accessToken: "fresh" });

    await expect(first).resolves.toEqual({ accessToken: "fresh" });
  });

  test("clears tokens when refresh fails", async () => {
    const { store, current } = createTokenStore({ accessToken: "old", refreshToken: "refresh" });
    const session = createMobileSession({
      store,
      refresh: async () => {
        throw new Error("refresh unavailable");
      },
    });

    await expect(session.refresh()).rejects.toThrow("refresh unavailable");
    expect(current()).toBeNull();
  });

  test("clears tokens when no refresh token is available", async () => {
    const { store, current } = createTokenStore({ accessToken: "old" });
    const session = createMobileSession({ store, refresh: async () => ({ accessToken: "new" }) });

    await expect(session.refresh()).rejects.toThrow("refresh token is unavailable");
    expect(current()).toBeNull();
  });

  test("uses bearer authentication, organization context, and omitted credentials", async () => {
    const { store } = createTokenStore({ accessToken: "mobile-access" });
    const { fetcher, calls } = createFakeFetch(jsonResponse({ user: null, session: null }));
    const client = createMobileApiClient({
      baseUrl: "https://api.example.test",
      store,
      fetch: fetcher,
      getOrganizationId: () => "org-mobile",
    });

    await client.auth.getSession();

    const call = calls[0];
    expect(call?.init?.credentials).toBe("omit");
    const headers = new Headers(call?.init?.headers);
    expect(headers.get("authorization")).toBe("Bearer mobile-access");
    expect(headers.get("x-organization-id")).toBe("org-mobile");
    expect(headers.get("cookie")).toBeNull();
  });

  test("does not log token values while using the session", async () => {
    const { store } = createTokenStore({
      accessToken: "secret-access",
      refreshToken: "secret-refresh",
    });
    const session = createMobileSession({ store });
    const originalLog = console.log;
    const logs: unknown[][] = [];
    console.log = (...args: unknown[]) => {
      logs.push(args);
    };
    try {
      await session.getAccessToken();
      await session.save({ accessToken: "another-secret" });
      await session.clear();
    } finally {
      console.log = originalLog;
    }

    expect(logs).toEqual([]);
  });
});

describe("mobile idempotency and uploads", () => {
  test("creates a prefixed UUID idempotency key when Web Crypto is available", () => {
    const key = createIdempotencyKey("mobile");
    expect(key.startsWith("mobile-")).toBe(true);
    if (typeof globalThis.crypto?.randomUUID === "function") {
      expect(key).toMatch(/^mobile-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    }
  });

  test("adds an idempotency key without mutating the input headers", () => {
    const original = new Headers({ "x-client": "mobile" });
    const result = withIdempotencyKey(original, "key-1");

    expect(result).not.toBe(original);
    expect(result.get("idempotency-key")).toBe("key-1");
    expect(result.get("x-client")).toBe("mobile");
    expect(original.get("idempotency-key")).toBeNull();
  });

  test("builds a file FormData body with filename and metadata fields", () => {
    const file = new File(["contents"], "notes.txt", { type: "text/plain" });
    const form = createMobileUploadForm(file, {
      folder: "documents",
      revision: 2,
      public: false,
      omitted: undefined,
      empty: null,
    });

    const uploaded = form.get("file");
    expect(uploaded).toBeInstanceOf(File);
    expect((uploaded as File).name).toBe("notes.txt");
    expect(form.get("folder")).toBe("documents");
    expect(form.get("revision")).toBe("2");
    expect(form.get("public")).toBe("false");
    expect(form.get("omitted")).toBeNull();
    expect(form.get("empty")).toBeNull();
  });
});

describe("offline mutation store and retry policy", () => {
  test("deduplicates by idempotency key while preserving insertion order", () => {
    const store = createInMemoryOfflineMutationStore<{ value: string }>();
    store.enqueue(mutation("first"));
    store.enqueue(mutation("second"));
    store.enqueue({ ...mutation("first"), payload: { value: "duplicate" } });

    expect(store.peekDue(0, 10).map((entry) => entry.idempotencyKey)).toEqual(["first", "second"]);
    expect(store.peekDue(0, 10)[0]?.payload).toEqual({ value: "first" });
  });

  test("selects due entries in stable order and honors the limit", () => {
    const store = createInMemoryOfflineMutationStore<{ value: string }>();
    store.enqueue(mutation("due-1", 10));
    store.enqueue(mutation("future", 100));
    store.enqueue(mutation("due-2", 20));

    expect(store.peekDue(20, 0)).toEqual([]);
    expect(store.peekDue(20, 1).map((entry) => entry.idempotencyKey)).toEqual(["due-1"]);
    expect(store.peekDue(20, 10).map((entry) => entry.idempotencyKey)).toEqual(["due-1", "due-2"]);
  });

  test("increments attempts and updates the next attempt time", () => {
    const store = createInMemoryOfflineMutationStore<{ value: string }>();
    store.enqueue(mutation("retry"));
    store.markAttempt("retry", 500);

    expect(store.peekDue(499, 10)).toEqual([]);
    expect(store.peekDue(500, 10)[0]).toMatchObject({
      idempotencyKey: "retry",
      attempts: 1,
      nextAttemptAt: 500,
    });
  });

  test("computes exponential delays with a cap", () => {
    expect(computeRetryDelay(0, { baseDelayMs: 100, maxDelayMs: 250 })).toBe(100);
    expect(computeRetryDelay(1, { baseDelayMs: 100, maxDelayMs: 250 })).toBe(200);
    expect(computeRetryDelay(2, { baseDelayMs: 100, maxDelayMs: 250 })).toBe(250);
    expect(computeRetryDelay(100, { baseDelayMs: 100, maxDelayMs: 250 })).toBe(250);
  });

  test("validates attempts and applies bounded jitter", () => {
    expect(() => computeRetryDelay(-1)).toThrow("non-negative integer");
    expect(() => computeRetryDelay(1.5)).toThrow("non-negative integer");
    expect(() => computeRetryDelay(Number.NaN)).toThrow("non-negative integer");
    expect(computeRetryDelay(1, { baseDelayMs: 100, maxDelayMs: 150, jitter: () => 40 })).toBe(40);
    expect(computeRetryDelay(1, { baseDelayMs: 100, maxDelayMs: 150, jitter: () => 500 })).toBe(
      150,
    );
    expect(() => computeRetryDelay(1, { jitter: () => -1 })).toThrow("non-negative number");
  });

  test("reports whether another attempt is allowed", () => {
    expect(shouldRetry(0, 1)).toBe(true);
    expect(shouldRetry(1, 1)).toBe(false);
    expect(() => shouldRetry(-1, 2)).toThrow("non-negative integer");
    expect(() => shouldRetry(0, 0)).toThrow("positive integer");
  });
});

describe("offline mutation runner", () => {
  test("removes successful mutations and sends the idempotency header", async () => {
    const store = createInMemoryOfflineMutationStore<{ value: string }>();
    store.enqueue(mutation("success"));
    const sentHeaders: Headers[] = [];
    const runner = createOfflineMutationRunner({
      store,
      now: () => 100,
      send: async (_entry, headers) => {
        sentHeaders.push(headers);
      },
    });

    await expect(runner()).resolves.toEqual({
      processed: 1,
      succeeded: 1,
      failed: 0,
      retried: 0,
      exhausted: 0,
      shouldRetry: false,
    });
    expect(store.peekDue(100, 10)).toEqual([]);
    expect(sentHeaders[0]?.get("idempotency-key")).toBe("success");
  });

  test("processes due entries once and schedules a bounded retry on failure", async () => {
    const store = createInMemoryOfflineMutationStore<{ value: string }>();
    store.enqueue(mutation("retry", 100));
    store.enqueue(mutation("not-due", 101));
    let sent = 0;
    const runner = createOfflineMutationRunner({
      store,
      now: () => 100,
      baseDelayMs: 50,
      maxDelayMs: 60,
      send: async () => {
        sent += 1;
        throw new Error("offline");
      },
    });

    await expect(runner.run()).resolves.toMatchObject({
      processed: 1,
      succeeded: 0,
      failed: 1,
      retried: 1,
      exhausted: 0,
      shouldRetry: true,
    });
    expect(sent).toBe(1);
    expect(store.peekDue(149, 10).map((entry) => entry.idempotencyKey)).toEqual(["not-due"]);
    expect(store.peekDue(150, 10).find((entry) => entry.idempotencyKey === "retry")).toMatchObject({
      attempts: 1,
      nextAttemptAt: 150,
    });
    expect(store.peekDue(100, 10).map((entry) => entry.idempotencyKey)).toEqual([]);
  });

  test("stops retrying after max attempts without using a timer", async () => {
    const store = createInMemoryOfflineMutationStore<{ value: string }>();
    store.enqueue(mutation("exhausted"));
    const runner = createOfflineMutationRunner({
      store,
      now: () => 0,
      maxAttempts: 1,
      send: async () => {
        throw new Error("permanent failure");
      },
    });

    await expect(runner()).resolves.toEqual({
      processed: 1,
      succeeded: 0,
      failed: 1,
      retried: 0,
      exhausted: 1,
      shouldRetry: false,
    });
    expect(store.peekDue(Number.POSITIVE_INFINITY, 10)[0]?.attempts).toBe(1);
    await expect(runner()).resolves.toMatchObject({ processed: 0 });
  });

  test("does not log mutation payloads", async () => {
    const store = createInMemoryOfflineMutationStore<{ secret: string }>();
    store.enqueue({ ...mutation("payload"), payload: { secret: "do-not-log" } });
    const originalLog = console.log;
    const logs: unknown[][] = [];
    console.log = (...args: unknown[]) => {
      logs.push(args);
    };
    try {
      const runner = createOfflineMutationRunner({
        store,
        now: () => 0,
        send: async () => undefined,
      });
      await runner.run();
    } finally {
      console.log = originalLog;
    }

    expect(logs).toEqual([]);
  });
});

describe("Tauri bridge and system-browser auth", () => {
  test("maps injected invoke commands and token arguments", async () => {
    const calls: { command: string; args?: Record<string, unknown> }[] = [];
    const invoke: TauriInvoke = async <T>(command: string, args?: Record<string, unknown>) => {
      calls.push(args === undefined ? { command } : { command, args });
      if (command === "read-keyring") {
        return { accessToken: "read-access" } as T;
      }
      return undefined as T;
    };
    const bridge = createTauriCredentialBridge(invoke, {
      read: "read-keyring",
      write: "write-keyring",
      clear: "clear-keyring",
    });

    await expect(bridge.read()).resolves.toEqual({ accessToken: "read-access" });
    await bridge.write({ accessToken: "write-access", refreshToken: "write-refresh" });
    await bridge.clear();

    expect(calls).toEqual([
      { command: "read-keyring" },
      {
        command: "write-keyring",
        args: { tokens: { accessToken: "write-access", refreshToken: "write-refresh" } },
      },
      { command: "clear-keyring" },
    ]);
  });

  test("uses documented default Tauri command names", async () => {
    const calls: string[] = [];
    const invoke: TauriInvoke = async <T>(command: string) => {
      calls.push(command);
      return undefined as T;
    };
    const bridge = createTauriCredentialBridge(invoke);

    await bridge.read();
    await bridge.write({ accessToken: "access" });
    await bridge.clear();

    expect(calls).toEqual([
      DEFAULT_TAURI_CREDENTIAL_COMMANDS.read,
      DEFAULT_TAURI_CREDENTIAL_COMMANDS.write,
      DEFAULT_TAURI_CREDENTIAL_COMMANDS.clear,
    ]);
  });

  test("uses the Tauri bridge through the bearer client", async () => {
    const bridge = {
      read: async () => ({ accessToken: "tauri-access" }),
      write: async (_tokens: MobileTokens) => undefined,
      clear: async () => undefined,
    };
    const { fetcher, calls } = createFakeFetch(jsonResponse({ user: null, session: null }));
    const client = createTauriApiClient({
      baseUrl: "https://api.example.test",
      bridge,
      fetch: fetcher,
      getOrganizationId: async () => "org-tauri",
    });

    await client.auth.getSession();

    expect(calls[0]?.init?.credentials).toBe("omit");
    const headers = new Headers(calls[0]?.init?.headers);
    expect(headers.get("authorization")).toBe("Bearer tauri-access");
    expect(headers.get("x-organization-id")).toBe("org-tauri");
  });

  test("opens the system browser and returns callback tokens without persisting them", async () => {
    const opened: string[] = [];
    const callbacks: string[] = [];
    const auth = createTauriSystemAuth({
      openExternal: async (url) => {
        opened.push(url);
      },
      callbackScheme: "consulting",
      onCallback: async (url) => {
        callbacks.push(url);
        return { accessToken: "callback-access", refreshToken: "callback-refresh" };
      },
    });

    await auth.startLogin("https://auth.example.test/system");
    await expect(auth.handleCallback("consulting://callback?code=one")).resolves.toEqual({
      accessToken: "callback-access",
      refreshToken: "callback-refresh",
    });
    expect(opened).toEqual(["https://auth.example.test/system"]);
    expect(callbacks).toEqual(["consulting://callback?code=one"]);
  });

  test("rejects mismatched callback schemes before invoking the callback handler", async () => {
    let callbackCalls = 0;
    const auth = createTauriSystemAuth({
      openExternal: async () => undefined,
      callbackScheme: "consulting://callback",
      onCallback: async () => {
        callbackCalls += 1;
        return { accessToken: "unexpected" };
      },
    });

    await expect(auth.handleCallback("https://callback.example.test?code=one")).rejects.toThrow(
      "callback URL scheme",
    );
    expect(callbackCalls).toBe(0);
  });

  test("rejects invalid callback schemes and malformed callback URLs", async () => {
    expect(() =>
      createTauriSystemAuth({
        openExternal: async () => undefined,
        callbackScheme: "not a scheme",
        onCallback: async () => ({ accessToken: "unused" }),
      }),
    ).toThrow("valid URI scheme");

    const auth = createTauriSystemAuth({
      openExternal: async () => undefined,
      callbackScheme: "consulting",
      onCallback: async () => ({ accessToken: "unused" }),
    });
    await expect(auth.handleCallback("not a URL")).rejects.toThrow("callback URL must be valid");
  });
});

describe("SDK runtime boundaries", () => {
  test("contains no native-runtime imports or token logging", async () => {
    for (const fileName of ["mobile.ts", "offline.ts", "tauri.ts"]) {
      const source = await Bun.file(new URL(`../src/${fileName}`, import.meta.url)).text();
      expect(source).not.toMatch(/from\s+["'](?:react-native|ignite|@tauri-apps|tauri|node:|bun:)/);
      expect(source).not.toMatch(
        /import\s*\(\s*["'](?:react-native|ignite|@tauri-apps|tauri|node:|bun:)/,
      );
      expect(source).not.toMatch(/console\.(?:log|debug|info|warn|error)/);
    }
  });
});
