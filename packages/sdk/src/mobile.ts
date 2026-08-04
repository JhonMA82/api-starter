import { type ApiClient, createApiClient } from "./client";
import type { ApiClientOptions, OrganizationIdGetter } from "./transport";

/** Tokens that an application keeps in a secure native credential store. */
export interface MobileTokens {
  accessToken: string;
  refreshToken?: string;
}

/**
 * Application-owned secure token storage.
 *
 * React Native/Ignite implementations should use Keychain, Keystore, or
 * SecureStore. AsyncStorage is not appropriate for secrets.
 */
export interface SecureTokenStore {
  get(): Promise<MobileTokens | null>;
  set(tokens: MobileTokens): Promise<void>;
  clear(): Promise<void>;
}

export interface RefreshSession {
  // biome-ignore lint/style/useShorthandFunctionType: Keep the documented callable interface.
  (refreshToken: string): Promise<MobileTokens>;
}

export interface MobileSession {
  getAccessToken(): Promise<string | undefined>;
  getTokens(): Promise<MobileTokens | null>;
  save(tokens: MobileTokens): Promise<void>;
  clear(): Promise<void>;
  refresh(): Promise<MobileTokens>;
}

export interface CreateMobileSessionOptions {
  store: SecureTokenStore;
  refresh?: RefreshSession;
}

/**
 * Creates a session boundary that keeps token persistence outside the SDK.
 * Concurrent refresh calls share one promise. A failed refresh clears the
 * store, and token values are never logged by this module.
 */
export function createMobileSession(options: CreateMobileSessionOptions): MobileSession {
  let refreshInFlight: Promise<MobileTokens> | undefined;

  const getTokens = (): Promise<MobileTokens | null> => options.store.get();

  const refresh = (): Promise<MobileTokens> => {
    if (refreshInFlight !== undefined) {
      return refreshInFlight;
    }

    const pending = (async (): Promise<MobileTokens> => {
      try {
        if (options.refresh === undefined) {
          throw new Error("refresh is not configured");
        }

        const current = await options.store.get();
        if (current?.refreshToken === undefined || current.refreshToken === "") {
          throw new Error("refresh token is unavailable");
        }

        const next = await options.refresh(current.refreshToken);
        await options.store.set(next);
        return next;
      } catch (error) {
        try {
          await options.store.clear();
        } catch {
          // Preserve the original refresh failure without exposing credentials.
        }
        throw error;
      }
    })();

    refreshInFlight = pending;
    pending.then(
      () => {
        if (refreshInFlight === pending) {
          refreshInFlight = undefined;
        }
      },
      () => {
        if (refreshInFlight === pending) {
          refreshInFlight = undefined;
        }
      },
    );
    return pending;
  };

  return {
    getAccessToken: async () => (await getTokens())?.accessToken,
    getTokens,
    save: (tokens) => options.store.set(tokens),
    clear: () => options.store.clear(),
    refresh,
  };
}

export interface CreateMobileApiClientOptions {
  baseUrl: string;
  store: SecureTokenStore;
  refresh?: RefreshSession;
  fetch?: typeof fetch;
  getOrganizationId?: OrganizationIdGetter;
}

/** Creates an API client that uses bearer tokens and never sends cookies. */
export function createMobileApiClient(options: CreateMobileApiClientOptions): ApiClient {
  const sessionOptions: CreateMobileSessionOptions = { store: options.store };
  if (options.refresh !== undefined) {
    sessionOptions.refresh = options.refresh;
  }
  const session = createMobileSession(sessionOptions);
  const clientOptions: ApiClientOptions = {
    baseUrl: options.baseUrl,
    credentials: "omit",
    getAccessToken: session.getAccessToken,
  };

  if (options.fetch !== undefined) {
    clientOptions.fetch = options.fetch;
  }
  if (options.getOrganizationId !== undefined) {
    clientOptions.getOrganizationId = options.getOrganizationId;
  }

  return createApiClient(clientOptions);
}

let fallbackIdempotencyCounter = 0;

function formatRandomBytes(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(
    16,
    20,
  )}-${hex.slice(20, 32)}`;
}

function createRandomIdentifier(): string {
  const webCrypto = globalThis.crypto;
  if (webCrypto !== undefined && typeof webCrypto.randomUUID === "function") {
    return webCrypto.randomUUID();
  }
  if (webCrypto !== undefined && typeof webCrypto.getRandomValues === "function") {
    return formatRandomBytes(webCrypto.getRandomValues(new Uint8Array(16)));
  }

  // Idempotency keys need process-local uniqueness when Web Crypto is absent.
  // Do not substitute a non-cryptographic pseudo-random source.
  fallbackIdempotencyCounter += 1;
  return `${Date.now().toString(36)}-${fallbackIdempotencyCounter.toString(36)}`;
}

/** Creates a UUID-backed idempotency key, optionally prefixed for diagnostics. */
export function createIdempotencyKey(prefix?: string): string {
  const identifier = createRandomIdentifier();
  const normalizedPrefix = prefix?.trim();
  return normalizedPrefix === undefined || normalizedPrefix === ""
    ? identifier
    : `${normalizedPrefix}-${identifier}`;
}

/** Returns new headers with an idempotency key; the input is never mutated. */
export function withIdempotencyKey(headers: HeadersInit = {}, key: string): Headers {
  const result = new Headers(headers);
  result.set("idempotency-key", key);
  return result;
}

export type MobileUploadMetadata = Readonly<
  Record<string, string | number | boolean | null | undefined>
>;

/**
 * Builds the multipart body expected by the files API without reading a path.
 * Metadata values are appended as text fields and nullish values are omitted.
 */
export function createMobileUploadForm(file: Blob, metadata?: MobileUploadMetadata): FormData {
  const form = new FormData();
  const namedFile = file as Blob & { name?: unknown };
  if (typeof namedFile.name === "string" && namedFile.name !== "") {
    form.append("file", file, namedFile.name);
  } else {
    form.append("file", file);
  }

  if (metadata !== undefined) {
    for (const [key, value] of Object.entries(metadata)) {
      if (value !== undefined && value !== null) {
        form.append(key, String(value));
      }
    }
  }
  return form;
}
