import { type Config, ConfigError, parseEnv } from "@consulting/config";

/**
 * Parses and validates environment configuration. On ConfigError, writes the
 * failure to stderr and exits non-zero (D2). Does NOT serve HTTP — the server
 * entrypoint lands in server.ts.
 */
export function loadConfig(): Config {
  try {
    return parseEnv();
  } catch (error) {
    if (!(error instanceof ConfigError)) {
      throw error;
    }
    process.stderr.write(`[config] invalid environment:\n${error.message}\n`);
    process.exit(1);
  }
}

loadConfig();
