import { z } from "zod";

export const envSchema = z.object({
  APP_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_VERSION: z.string().min(1).default("0.11.0"),
  API_BASE_URL: z.url().default("http://localhost:3000"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().min(1).default("0.0.0.0"),
  CORS_ORIGINS: z
    .string()
    .default("")
    .transform((value) =>
      value
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
  DATABASE_URL: z.url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url().optional(),
  TRUSTED_ORIGINS: z
    .string()
    .default("")
    .transform((value) =>
      value
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
});

export type Config = z.infer<typeof envSchema>;

export class ConfigError extends Error {
  constructor(issues: z.ZodIssue[]) {
    const details = issues
      .map((issue) => {
        const field = issue.path.join(".");
        return `  - ${field}: ${issue.message}`;
      })
      .join("\n");
    super(`Invalid environment configuration:\n${details}`);
    this.name = "ConfigError";
  }
}

export function parseEnv(env: NodeJS.ProcessEnv = process.env): Config {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    throw new ConfigError(result.error.issues);
  }
  return result.data;
}
