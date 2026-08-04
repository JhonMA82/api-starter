import { describe, expect, test } from "bun:test";

import { ApiClientError, createApiClient, createTransport, isApiClientError } from "../src/index";

interface FetchCall {
  input: RequestInfo | URL;
  init: RequestInit | undefined;
}

type FetchResponder = (call: FetchCall, callNumber: number) => Response | Promise<Response>;

function jsonResponse(body: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function fakeFetch(responder: FetchResponder = () => jsonResponse({ ok: true })) {
  const calls: FetchCall[] = [];
  const fetcher = (async (input, init) => {
    const call: FetchCall = { input, init: init as RequestInit | undefined };
    calls.push(call);
    return responder(call, calls.length);
  }) as typeof fetch;
  return { calls, fetcher };
}

function responseSequence(...responses: Response[]): FetchResponder {
  return (_call, callNumber) =>
    responses[callNumber - 1] ?? responseAt(responses, responses.length - 1);
}

function responseAt(responses: Response[], index: number): Response {
  const response = responses[index];
  if (response === undefined) {
    throw new Error(`missing fake response at index ${index}`);
  }
  return response;
}

function callAt(calls: FetchCall[], index: number): FetchCall {
  const call = calls[index];
  if (call === undefined) {
    throw new Error(`missing fetch call at index ${index}`);
  }
  return call;
}

function urlOf(call: FetchCall): string {
  return String(call.input);
}

function headersOf(call: FetchCall): Headers {
  return new Headers(call.init?.headers);
}

describe("transport setup and headers", () => {
  test("normalizes the base URL and applies default credentials and auth headers", async () => {
    const { fetcher, calls } = fakeFetch();
    const transport = createTransport({
      baseUrl: "https://api.example.test///",
      fetch: fetcher,
      headers: { "x-client": "sdk" },
      getAccessToken: async () => "access-token",
      getOrganizationId: () => "org-current",
    });

    await transport.request("/health", { headers: { "x-request": "request" } });

    expect(transport.baseUrl).toBe("https://api.example.test");
    expect(urlOf(callAt(calls, 0))).toBe("https://api.example.test/health");
    expect(calls[0]?.init?.credentials).toBe("include");
    expect(headersOf(callAt(calls, 0)).get("authorization")).toBe("Bearer access-token");
    expect(headersOf(callAt(calls, 0)).get("x-client")).toBe("sdk");
    expect(headersOf(callAt(calls, 0)).get("x-organization-id")).toBe("org-current");
    expect(headersOf(callAt(calls, 0)).get("x-request")).toBe("request");
  });

  test("uses caller credentials and keeps headers when token and organization are absent", async () => {
    const { fetcher, calls } = fakeFetch();
    const transport = createTransport({
      baseUrl: "https://api.example.test/",
      fetch: fetcher,
      credentials: "same-origin",
      getAccessToken: () => undefined,
      getOrganizationId: () => undefined,
    });

    await transport.request("health", {
      credentials: "omit",
      headers: { authorization: "Bearer caller-token", "x-custom": "value" },
    });

    expect(calls[0]?.init?.credentials).toBe("omit");
    expect(headersOf(callAt(calls, 0)).get("authorization")).toBe("Bearer caller-token");
    expect(headersOf(callAt(calls, 0)).get("x-organization-id")).toBeNull();
    expect(headersOf(callAt(calls, 0)).get("x-custom")).toBe("value");
  });

  test("uses a per-request organization override without mutating the getter result", async () => {
    const { fetcher, calls } = fakeFetch();
    const transport = createTransport({
      baseUrl: "https://api.example.test",
      fetch: fetcher,
      getOrganizationId: () => "org-current",
    });

    await transport.request("/first", { organizationId: "org-override" });
    await transport.request("/second");

    expect(headersOf(callAt(calls, 0)).get("x-organization-id")).toBe("org-override");
    expect(headersOf(callAt(calls, 1)).get("x-organization-id")).toBe("org-current");
  });

  test("accepts HeadersInit from options and request while request headers win", async () => {
    const { fetcher, calls } = fakeFetch();
    const transport = createTransport({
      baseUrl: "https://api.example.test",
      fetch: fetcher,
      headers: new Headers([
        ["x-shared", "options"],
        ["x-option-only", "present"],
      ]),
    });

    await transport.request("/headers", {
      headers: [
        ["x-shared", "request"],
        ["x-request-only", "present"],
      ],
    });

    expect(headersOf(callAt(calls, 0)).get("x-shared")).toBe("request");
    expect(headersOf(callAt(calls, 0)).get("x-option-only")).toBe("present");
    expect(headersOf(callAt(calls, 0)).get("x-request-only")).toBe("present");
  });

  test("allows an absolute request URL for transport-level calls", async () => {
    const { fetcher, calls } = fakeFetch();
    const transport = createTransport({ baseUrl: "https://api.example.test", fetch: fetcher });

    await transport.request("https://other.example.test/status");

    expect(urlOf(callAt(calls, 0))).toBe("https://other.example.test/status");
  });

  test("rejects an empty base URL", () => {
    expect(() => createTransport({ baseUrl: "   " })).toThrow("baseUrl must not be empty");
  });
});

describe("transport body and response handling", () => {
  test("serializes JSON bodies and sets content type", async () => {
    const { fetcher, calls } = fakeFetch();
    const transport = createTransport({ baseUrl: "https://api.example.test", fetch: fetcher });

    await transport.json("/json", { method: "POST", body: { name: "Acme" } });

    expect(calls[0]?.init?.method).toBe("POST");
    expect(headersOf(callAt(calls, 0)).get("content-type")).toBe("application/json");
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ name: "Acme" }));
  });

  test("preserves an explicit JSON content type and already encoded strings", async () => {
    const { fetcher, calls } = fakeFetch();
    const transport = createTransport({ baseUrl: "https://api.example.test", fetch: fetcher });

    await transport.json("/json", {
      method: "POST",
      headers: { "content-type": "application/vnd.api+json" },
      body: "encoded-body",
    });

    expect(headersOf(callAt(calls, 0)).get("content-type")).toBe("application/vnd.api+json");
    expect(calls[0]?.init?.body).toBe("encoded-body");
  });

  test("does not force content type for FormData", async () => {
    const { fetcher, calls } = fakeFetch();
    const transport = createTransport({ baseUrl: "https://api.example.test", fetch: fetcher });
    const formData = new FormData();
    formData.set("file", new Blob(["contents"], { type: "text/plain" }), "notes.txt");

    await transport.form("/files", formData, { method: "POST" });

    expect(headersOf(callAt(calls, 0)).get("content-type")).toBeNull();
    expect(calls[0]?.init?.body).toBe(formData);
  });

  test("parses JSON success responses", async () => {
    const { fetcher } = fakeFetch(() => jsonResponse({ value: 42 }));
    const transport = createTransport({ baseUrl: "https://api.example.test", fetch: fetcher });

    await expect(transport.request<{ value: number }>("/value")).resolves.toEqual({ value: 42 });
  });

  test("returns undefined for 204 responses", async () => {
    const { fetcher } = fakeFetch(() => new Response(null, { status: 204 }));
    const transport = createTransport({ baseUrl: "https://api.example.test", fetch: fetcher });

    await expect(transport.request("/empty")).resolves.toBeUndefined();
  });

  test("does not parse a successful non-JSON response", async () => {
    const { fetcher } = fakeFetch(
      () => new Response("plain text", { status: 200, headers: { "content-type": "text/plain" } }),
    );
    const transport = createTransport({ baseUrl: "https://api.example.test", fetch: fetcher });

    await expect(transport.request("/text")).resolves.toBeUndefined();
  });

  test("maps malformed JSON success into a safe ApiClientError", async () => {
    const { fetcher } = fakeFetch(
      () =>
        new Response("secret-success-body", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const transport = createTransport({ baseUrl: "https://api.example.test", fetch: fetcher });

    const error = await transport.request("/malformed").catch((caught) => caught);

    expect(isApiClientError(error)).toBe(true);
    expect((error as ApiClientError).code).toBe("INVALID_JSON");
    expect(String(error)).not.toContain("secret-success-body");
  });

  test("maps problem+json fields and drops unknown secret fields", async () => {
    const { fetcher } = fakeFetch(
      () =>
        new Response(
          JSON.stringify({
            type: "https://example.test/problems/conflict",
            title: "Conflict",
            status: 409,
            code: "CONFLICT",
            detail: "Slug already exists",
            instance: "/api/v1/organizations",
            requestId: "request-123",
            errors: [{ field: "slug", message: "already exists" }],
            secret: "do-not-leak",
          }),
          { status: 409, headers: { "content-type": "application/problem+json" } },
        ),
    );
    const transport = createTransport({ baseUrl: "https://api.example.test", fetch: fetcher });

    const error = await transport.request("/conflict").catch((caught) => caught);

    expect(error).toBeInstanceOf(ApiClientError);
    const apiError = error as ApiClientError;
    expect(apiError.status).toBe(409);
    expect(apiError.code).toBe("CONFLICT");
    expect(apiError.requestId).toBe("request-123");
    expect(apiError.problem).toEqual({
      type: "https://example.test/problems/conflict",
      title: "Conflict",
      status: 409,
      code: "CONFLICT",
      detail: "Slug already exists",
      instance: "/api/v1/organizations",
      requestId: "request-123",
      errors: [{ field: "slug", message: "already exists" }],
    });
    expect(JSON.stringify(apiError)).not.toContain("do-not-leak");
    expect(apiError.message).toContain("409 CONFLICT");
  });

  test("falls back safely for malformed problem JSON", async () => {
    const { fetcher } = fakeFetch(
      () =>
        new Response("malformed-secret-body", {
          status: 502,
          headers: { "content-type": "application/problem+json" },
        }),
    );
    const transport = createTransport({ baseUrl: "https://api.example.test", fetch: fetcher });

    const error = await transport.request("/bad-problem").catch((caught) => caught);

    expect(error).toBeInstanceOf(ApiClientError);
    expect((error as ApiClientError).status).toBe(502);
    expect((error as ApiClientError).code).toBe("HTTP_502");
    expect(String(error)).not.toContain("malformed-secret-body");
  });

  test("does not expose a non-JSON error body", async () => {
    const { fetcher } = fakeFetch(
      () =>
        new Response("raw-secret-response", {
          status: 500,
          headers: { "content-type": "text/plain" },
        }),
    );
    const transport = createTransport({ baseUrl: "https://api.example.test", fetch: fetcher });

    const error = await transport.request("/internal-error").catch((caught) => caught);

    expect(error).toBeInstanceOf(ApiClientError);
    expect((error as ApiClientError).code).toBe("HTTP_500");
    expect(JSON.stringify(error)).not.toContain("raw-secret-response");
  });

  test("bounds problem parsing before JSON decoding", async () => {
    const { fetcher } = fakeFetch(
      () =>
        new Response(`{"secret":"${"x".repeat(20_000)}"}`, {
          status: 400,
          headers: { "content-type": "application/json" },
        }),
    );
    const transport = createTransport({ baseUrl: "https://api.example.test", fetch: fetcher });

    const error = await transport.request("/large-error").catch((caught) => caught);

    expect(error).toBeInstanceOf(ApiClientError);
    expect(JSON.stringify(error)).not.toContain("x".repeat(1_024));
  });

  test("identifies only ApiClientError instances", () => {
    expect(isApiClientError(new Error("other"))).toBe(false);
    expect(
      isApiClientError(
        new ApiClientError(400, {
          type: "about:blank",
          title: "Bad request",
          status: 400,
          code: "VALIDATION_FAILED",
          requestId: "request-1",
        }),
      ),
    ).toBe(true);
  });
});

describe("auth and organization resources", () => {
  test("gets a session from the Better Auth-compatible endpoint", async () => {
    const { fetcher, calls } = fakeFetch(() => jsonResponse({ custom: true }));
    const client = createApiClient({ baseUrl: "https://api.example.test/", fetch: fetcher });

    const session = await client.auth.getSession<{ custom: true }>();

    expect(session).toEqual({ custom: true });
    expect(urlOf(callAt(calls, 0))).toBe("https://api.example.test/api/auth/get-session");
    expect(calls[0]?.init?.method).toBeUndefined();
  });

  test("creates an organization with the expected JSON method and body", async () => {
    const { fetcher, calls } = fakeFetch(() => jsonResponse({ id: "org-1" }, 201));
    const client = createApiClient({ baseUrl: "https://api.example.test", fetch: fetcher });

    await client.organizations.create({ name: "Acme", slug: "acme" });

    expect(urlOf(callAt(calls, 0))).toBe("https://api.example.test/api/v1/organizations");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ name: "Acme", slug: "acme" });
  });

  test("resolves an encoded organization context and overrides its tenant header", async () => {
    const { fetcher, calls } = fakeFetch(() => jsonResponse({ organizationId: "org/a" }));
    const client = createApiClient({
      baseUrl: "https://api.example.test",
      fetch: fetcher,
      getOrganizationId: () => "org-current",
    });

    await client.organizations.context("org/a with spaces");

    expect(urlOf(callAt(calls, 0))).toContain("/api/v1/organizations/org%2Fa%20with%20spaces");
    expect(headersOf(callAt(calls, 0)).get("x-organization-id")).toBe("org/a with spaces");
  });

  test("invites and accepts invitations with their distinct paths and methods", async () => {
    const { fetcher, calls } = fakeFetch(
      responseSequence(
        jsonResponse({ invitation: {}, token: "token" }, 201),
        jsonResponse({ id: "membership" }),
      ),
    );
    const client = createApiClient({ baseUrl: "https://api.example.test", fetch: fetcher });

    await client.organizations.invite("org-1", { email: "member@example.com", role: "member" });
    await client.organizations.acceptInvitation({ token: "token" });

    expect(urlOf(callAt(calls, 0))).toBe(
      "https://api.example.test/api/v1/organizations/org-1/invitations",
    );
    expect(calls[0]?.init?.method).toBe("POST");
    expect(headersOf(callAt(calls, 0)).get("x-organization-id")).toBe("org-1");
    expect(urlOf(callAt(calls, 1))).toBe(
      "https://api.example.test/api/v1/organizations/accept-invitation",
    );
    expect(calls[1]?.init?.method).toBe("POST");
  });

  test("transfers ownership and suspends an organization", async () => {
    const { fetcher, calls } = fakeFetch(
      responseSequence(
        jsonResponse({ previousOwner: {}, newOwner: {} }),
        jsonResponse({ id: "org-1" }),
      ),
    );
    const client = createApiClient({ baseUrl: "https://api.example.test", fetch: fetcher });

    await client.organizations.transferOwnership("org-1", { newOwnerUserId: "user-2" });
    await client.organizations.suspend("org-1");

    expect(urlOf(callAt(calls, 0))).toContain("/api/v1/organizations/org-1/ownership");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ newOwnerUserId: "user-2" });
    expect(urlOf(callAt(calls, 1))).toContain("/api/v1/organizations/org-1/suspend");
    expect(calls[1]?.init?.method).toBe("POST");
  });

  test("removes members and encodes the required delete confirmation query", async () => {
    const { fetcher, calls } = fakeFetch(
      responseSequence(new Response(null, { status: 204 }), new Response(null, { status: 204 })),
    );
    const client = createApiClient({ baseUrl: "https://api.example.test", fetch: fetcher });

    await client.organizations.removeMember("org/1", "user with spaces");
    await client.organizations.delete("org/1", { confirm: true });

    expect(urlOf(callAt(calls, 0))).toContain(
      "/api/v1/organizations/org%2F1/members/user%20with%20spaces",
    );
    expect(calls[0]?.init?.method).toBe("DELETE");
    expect(urlOf(callAt(calls, 1))).toBe(
      "https://api.example.test/api/v1/organizations/org%2F1?confirm=true",
    );
    expect(calls[1]?.init?.method).toBe("DELETE");
  });
});

describe("API keys and files resources", () => {
  test("creates and revokes an API key with encoded organization and key ids", async () => {
    const { fetcher, calls } = fakeFetch(
      responseSequence(
        jsonResponse({ apiKey: {}, secret: "one-time" }, 201),
        new Response(null, { status: 204 }),
      ),
    );
    const client = createApiClient({ baseUrl: "https://api.example.test", fetch: fetcher });

    await client.apiKeys.create("org/1", { name: "CI", expiresAt: "2027-01-01T00:00:00.000Z" });
    await client.apiKeys.revoke("org/1", "key/1");

    expect(urlOf(callAt(calls, 0))).toBe(
      "https://api.example.test/api/v1/organizations/org%2F1/api-keys",
    );
    expect(headersOf(callAt(calls, 0)).get("x-organization-id")).toBe("org/1");
    expect(urlOf(callAt(calls, 1))).toContain("/api-keys/key%2F1");
    expect(calls[1]?.init?.method).toBe("DELETE");
  });

  test("lists and gets files with URL-encoded limits and ids", async () => {
    const { fetcher, calls } = fakeFetch(
      responseSequence(jsonResponse({ files: [] }), jsonResponse({ id: "file/1" })),
    );
    const client = createApiClient({ baseUrl: "https://api.example.test", fetch: fetcher });

    await client.files.list({ limit: 7, organizationId: "org-1" });
    await client.files.get("file/1", { organizationId: "org-1" });

    expect(urlOf(callAt(calls, 0))).toBe("https://api.example.test/api/v1/files?limit=7");
    expect(headersOf(callAt(calls, 0)).get("x-organization-id")).toBe("org-1");
    expect(urlOf(callAt(calls, 1))).toContain("/api/v1/files/file%2F1");
  });

  test("uploads FormData and issues a download URL without setting multipart content type", async () => {
    const { fetcher, calls } = fakeFetch(
      responseSequence(
        jsonResponse({ file: {}, downloadUrl: "https://download", expiresIn: 3600 }, 201),
        jsonResponse({ downloadUrl: "https://download", expiresIn: 60 }),
      ),
    );
    const client = createApiClient({ baseUrl: "https://api.example.test", fetch: fetcher });
    const formData = new FormData();
    formData.set("file", new Blob(["contents"], { type: "text/plain" }), "notes.txt");

    await client.files.upload(formData, { organizationId: "org-1" });
    await client.files.createDownloadUrl("file/1", {
      organizationId: "org-1",
      expiresInSeconds: 60,
    });

    expect(headersOf(callAt(calls, 0)).get("content-type")).toBeNull();
    expect(calls[0]?.init?.body).toBe(formData);
    expect(urlOf(callAt(calls, 1))).toContain("/api/v1/files/file%2F1/url");
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({ expiresInSeconds: 60 });
  });

  test("deletes a file with the tenant override", async () => {
    const { fetcher, calls } = fakeFetch(() => new Response(null, { status: 204 }));
    const client = createApiClient({ baseUrl: "https://api.example.test", fetch: fetcher });

    await client.files.delete("file-1", { organizationId: "org-1" });

    expect(calls[0]?.init?.method).toBe("DELETE");
    expect(headersOf(callAt(calls, 0)).get("x-organization-id")).toBe("org-1");
  });
});

describe("webhook resources", () => {
  test("creates and lists organization webhooks", async () => {
    const { fetcher, calls } = fakeFetch(
      responseSequence(jsonResponse({ endpoint: {}, secret: "one-time" }, 201), jsonResponse([])),
    );
    const client = createApiClient({ baseUrl: "https://api.example.test", fetch: fetcher });

    await client.webhooks.create("org/1", {
      url: "https://hooks.example.test/receive",
      events: ["organization.created"],
    });
    await client.webhooks.list("org/1");

    expect(urlOf(callAt(calls, 0))).toContain("/api/v1/organizations/org%2F1/webhooks");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      url: "https://hooks.example.test/receive",
      events: ["organization.created"],
    });
    expect(headersOf(callAt(calls, 1)).get("x-organization-id")).toBe("org/1");
  });

  test("rotates and toggles a webhook with encoded ids", async () => {
    const { fetcher, calls } = fakeFetch(
      responseSequence(
        jsonResponse({ endpoint: {}, secret: "new" }),
        jsonResponse({ id: "webhook" }),
      ),
    );
    const client = createApiClient({ baseUrl: "https://api.example.test", fetch: fetcher });

    await client.webhooks.rotate("org/1", "webhook/1");
    await client.webhooks.toggle("org/1", "webhook/1", { active: false });

    expect(urlOf(callAt(calls, 0))).toContain("/webhooks/webhook%2F1/rotate");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(urlOf(callAt(calls, 1))).toContain("/webhooks/webhook%2F1/toggle");
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({ active: false });
  });

  test("lists webhook deliveries with an encoded limit query", async () => {
    const { fetcher, calls } = fakeFetch(() => jsonResponse([]));
    const client = createApiClient({ baseUrl: "https://api.example.test", fetch: fetcher });

    await client.webhooks.deliveries("org/1", "webhook/1", 25);

    expect(urlOf(callAt(calls, 0))).toBe(
      "https://api.example.test/api/v1/organizations/org%2F1/webhooks/webhook%2F1/deliveries?limit=25",
    );
    expect(headersOf(callAt(calls, 0)).get("x-organization-id")).toBe("org/1");
  });

  test("omits optional query values rather than sending undefined", async () => {
    const { fetcher, calls } = fakeFetch(() => jsonResponse([]));
    const client = createApiClient({ baseUrl: "https://api.example.test", fetch: fetcher });

    await client.webhooks.deliveries("org-1", "webhook-1");

    expect(urlOf(callAt(calls, 0))).not.toContain("?");
  });
});
