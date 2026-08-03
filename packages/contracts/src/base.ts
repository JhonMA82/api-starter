import { z } from "zod";

export const HealthResponse = z.object({
  status: z.literal("ok"),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

export const ReadyResponse = z.object({
  status: z.literal("ready"),
  checks: z.record(z.string(), z.literal("ok")).default({}),
});
export type ReadyResponse = z.infer<typeof ReadyResponse>;

export const VersionResponse = z.object({
  name: z.string(),
  version: z.string(),
  environment: z.enum(["development", "test", "production"]),
});
export type VersionResponse = z.infer<typeof VersionResponse>;
