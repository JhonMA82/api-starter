import type { ApiClient } from "./client";
import {
  createMobileApiClient,
  type MobileTokens,
  type RefreshSession,
  type SecureTokenStore,
} from "./mobile";
import type { OrganizationIdGetter } from "./transport";

export type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export interface TauriCredentialBridge {
  read(): Promise<MobileTokens | null>;
  write(tokens: MobileTokens): Promise<void>;
  clear(): Promise<void>;
}

export interface TauriCredentialCommands {
  read: string;
  write: string;
  clear: string;
}

export type TauriCredentialCommandOverrides = Partial<TauriCredentialCommands>;

/** Native command names expected by the default bridge adapter. */
export const DEFAULT_TAURI_CREDENTIAL_COMMANDS: TauriCredentialCommands = Object.freeze({
  read: "auth_read_tokens",
  write: "auth_write_tokens",
  clear: "auth_clear_tokens",
});

function resolveCommands(
  overrides: TauriCredentialCommandOverrides | undefined,
): TauriCredentialCommands {
  const commands = {
    ...DEFAULT_TAURI_CREDENTIAL_COMMANDS,
    ...overrides,
  };
  for (const [operation, command] of Object.entries(commands)) {
    if (command.trim() === "") {
      throw new TypeError(`${operation} command must not be empty`);
    }
  }
  return commands;
}

/**
 * Adapts injected native commands to a credential bridge. The native side is
 * responsible for storing values in a keyring or secure-store plugin; this
 * adapter never logs credentials.
 */
export function createTauriCredentialBridge(
  invoke: TauriInvoke,
  commands?: TauriCredentialCommandOverrides,
): TauriCredentialBridge {
  const resolvedCommands = resolveCommands(commands);
  return {
    read: () => invoke<MobileTokens | null>(resolvedCommands.read),
    write: (tokens) => invoke<void>(resolvedCommands.write, { tokens }),
    clear: () => invoke<void>(resolvedCommands.clear),
  };
}

export interface CreateTauriApiClientOptions {
  baseUrl: string;
  bridge: TauriCredentialBridge;
  refresh?: RefreshSession;
  fetch?: typeof fetch;
  getOrganizationId?: OrganizationIdGetter;
}

/** Creates a Tauri client without importing any Tauri package. */
export function createTauriApiClient(options: CreateTauriApiClientOptions): ApiClient {
  const store: SecureTokenStore = {
    get: () => options.bridge.read(),
    set: (tokens) => options.bridge.write(tokens),
    clear: () => options.bridge.clear(),
  };
  const clientOptions: {
    baseUrl: string;
    store: SecureTokenStore;
    refresh?: RefreshSession;
    fetch?: typeof fetch;
    getOrganizationId?: OrganizationIdGetter;
  } = { baseUrl: options.baseUrl, store };
  if (options.refresh !== undefined) {
    clientOptions.refresh = options.refresh;
  }
  if (options.fetch !== undefined) {
    clientOptions.fetch = options.fetch;
  }
  if (options.getOrganizationId !== undefined) {
    clientOptions.getOrganizationId = options.getOrganizationId;
  }
  return createMobileApiClient(clientOptions);
}

export interface TauriSystemAuthOptions {
  openExternal(url: string): Promise<void>;
  callbackScheme: string;
  onCallback(url: string): Promise<MobileTokens>;
}

export interface TauriSystemAuth {
  startLogin(authUrl: string): Promise<void>;
  handleCallback(url: string): Promise<MobileTokens>;
}

function normalizeCallbackProtocol(callbackScheme: string): string {
  const value = callbackScheme.trim();
  if (value === "") {
    throw new TypeError("callbackScheme must not be empty");
  }

  let protocol = value;
  if (value.includes("://")) {
    try {
      protocol = new URL(value).protocol.slice(0, -1);
    } catch {
      throw new TypeError("callbackScheme must be a valid URI scheme");
    }
  } else if (value.endsWith(":")) {
    protocol = value.slice(0, -1);
  }

  if (!/^[A-Za-z][A-Za-z0-9+.-]*$/.test(protocol)) {
    throw new TypeError("callbackScheme must be a valid URI scheme");
  }
  return `${protocol.toLowerCase()}:`;
}

/**
 * Coordinates system-browser authentication. Callback token persistence stays
 * with the caller's MobileSession or Tauri credential bridge.
 */
export function createTauriSystemAuth(options: TauriSystemAuthOptions): TauriSystemAuth {
  const expectedProtocol = normalizeCallbackProtocol(options.callbackScheme);

  return {
    startLogin: (authUrl) => options.openExternal(authUrl),
    handleCallback: async (url) => {
      let callback: URL;
      try {
        callback = new URL(url);
      } catch {
        throw new TypeError("callback URL must be valid");
      }
      if (callback.protocol.toLowerCase() !== expectedProtocol) {
        throw new Error(`callback URL scheme must be ${expectedProtocol}`);
      }
      return options.onCallback(url);
    },
  };
}
