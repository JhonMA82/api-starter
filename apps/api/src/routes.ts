import type { Config } from "@consulting/config";
import {
  HealthResponse,
  ProblemDetailsSchema,
  ReadyResponse,
  VersionResponse,
} from "@consulting/contracts";
import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";

function errorResponses() {
  const problem = { "application/problem+json": { schema: resolver(ProblemDetailsSchema) } };
  return {
    400: { description: "Validation failed", content: problem },
    500: { description: "Internal error", content: problem },
  };
}

export function createRoutes(config: Config): Hono {
  const app = new Hono();

  app.get(
    "/health",
    describeRoute({
      description: "Liveness probe",
      responses: {
        200: {
          description: "Service is healthy",
          content: { "application/json": { schema: resolver(HealthResponse) } },
        },
        ...errorResponses(),
      },
    }),
    (c) => c.json({ status: "ok" }, 200),
  );

  app.get(
    "/ready",
    describeRoute({
      description: "Readiness probe",
      responses: {
        200: {
          description: "Service is ready",
          content: { "application/json": { schema: resolver(ReadyResponse) } },
        },
        ...errorResponses(),
      },
    }),
    (c) => c.json({ status: "ready", checks: {} }, 200),
  );

  app.get(
    "/version",
    describeRoute({
      description: "Service version and environment",
      responses: {
        200: {
          description: "Version information",
          content: { "application/json": { schema: resolver(VersionResponse) } },
        },
        ...errorResponses(),
      },
    }),
    (c) =>
      c.json(
        {
          name: "@consulting/api",
          version: config.APP_VERSION,
          environment: config.APP_ENV,
        },
        200,
      ),
  );

  return app;
}
