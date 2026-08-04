import { createApiClientError } from "./errors";

const MAX_PROBLEM_BODY_BYTES = 16 * 1024;

export type AccessTokenGetter = () => string | undefined | Promise<string | undefined>;
export type OrganizationIdGetter = () => string | undefined | Promise<string | undefined>;

export interface ApiClientOptions {
  baseUrl: string;
  fetch?: typeof fetch;
  credentials?: RequestCredentials;
  headers?: HeadersInit;
  getAccessToken?: AccessTokenGetter;
  getOrganizationId?: OrganizationIdGetter;
}

/** RequestInit plus an organization header override consumed by the transport. */
export interface ApiRequestInit extends RequestInit {
  organizationId?: string;
}

/** JSON request options accept an unencoded body and serialize it before fetch. */
export interface ApiJsonRequestInit extends Omit<ApiRequestInit, "body"> {
  body?: unknown;
}

export interface ApiTransport {
  readonly baseUrl: string;
  request<T>(path: string, init?: ApiRequestInit): Promise<T | undefined>;
  json<T>(path: string, init?: ApiJsonRequestInit): Promise<T | undefined>;
  form<T>(path: string, formData: FormData, init?: ApiRequestInit): Promise<T | undefined>;
}

function normalizeBaseUrl(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, "");
  if (normalized === "") {
    throw new TypeError("baseUrl must not be empty");
  }
  return normalized;
}

function resolveUrl(baseUrl: string, path: string): string {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }
  return `${baseUrl}/${path.replace(/^\/+/, "")}`;
}

function isJsonContentType(contentType: string | null): boolean {
  if (contentType === null) {
    return false;
  }
  const mediaType = contentType.split(";", 1)[0]?.trim().toLowerCase();
  return (
    mediaType === "application/json" ||
    mediaType === "application/problem+json" ||
    mediaType === "text/json" ||
    mediaType?.endsWith("+json") === true
  );
}

async function readBoundedText(response: Response): Promise<string> {
  if (response.body === null) {
    return "";
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (byteLength < MAX_PROBLEM_BODY_BYTES) {
      const result = await reader.read();
      if (result.done) {
        break;
      }
      const value = result.value;
      const remaining = MAX_PROBLEM_BODY_BYTES - byteLength;
      const chunk = value.byteLength > remaining ? value.slice(0, remaining) : value;
      chunks.push(chunk);
      byteLength += chunk.byteLength;
      if (chunk.byteLength < value.byteLength) {
        await reader.cancel();
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function parseJson(text: string): unknown {
  if (text === "") {
    return undefined;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

async function parseResponse<T>(response: Response): Promise<T | undefined> {
  if (!response.ok) {
    const payload = isJsonContentType(response.headers.get("content-type"))
      ? parseJson(await readBoundedText(response))
      : undefined;
    throw createApiClientError(response.status, payload);
  }

  if (response.status === 204) {
    return undefined;
  }
  if (!isJsonContentType(response.headers.get("content-type"))) {
    return undefined;
  }

  try {
    return (await response.json()) as T;
  } catch {
    throw createApiClientError(response.status, {
      type: "about:blank",
      title: "Invalid JSON response",
      status: response.status,
      code: "INVALID_JSON",
      requestId: "",
    });
  }
}

function mergeHeaders(...sources: (HeadersInit | undefined)[]): Headers {
  const merged = new Headers();
  for (const source of sources) {
    if (source === undefined) {
      continue;
    }
    new Headers(source).forEach((value, key) => {
      merged.set(key, value);
    });
  }
  return merged;
}

export function createTransport(options: ApiClientOptions): ApiTransport {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new TypeError("a standard fetch implementation is required");
  }

  async function request<T>(path: string, init: ApiRequestInit = {}): Promise<T | undefined> {
    const { organizationId, headers: requestHeaders, ...requestInit } = init;
    const headers = mergeHeaders(options.headers, requestHeaders);
    const accessToken = await options.getAccessToken?.();
    if (accessToken !== undefined && accessToken !== "") {
      headers.set("authorization", `Bearer ${accessToken}`);
    }

    const currentOrganizationId =
      organizationId === undefined ? await options.getOrganizationId?.() : organizationId;
    if (currentOrganizationId !== undefined && currentOrganizationId !== "") {
      headers.set("x-organization-id", currentOrganizationId);
    }

    const response = await fetchImpl(resolveUrl(baseUrl, path), {
      ...requestInit,
      credentials: requestInit.credentials ?? options.credentials ?? "include",
      headers,
    });
    return parseResponse<T>(response);
  }

  async function json<T>(path: string, init: ApiJsonRequestInit = {}): Promise<T | undefined> {
    const { body, ...requestInit } = init;
    const headers = new Headers(requestInit.headers);
    if (body !== undefined && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
    const encodedInit: ApiRequestInit = { ...requestInit, headers };
    if (body !== undefined) {
      encodedInit.body = typeof body === "string" ? body : JSON.stringify(body);
    }
    return request<T>(path, encodedInit);
  }

  async function form<T>(
    path: string,
    formData: FormData,
    init: ApiRequestInit = {},
  ): Promise<T | undefined> {
    return request<T>(path, { ...init, body: formData });
  }

  return { baseUrl, request, json, form };
}
