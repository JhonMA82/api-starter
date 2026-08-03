import type { AuditLogger } from "@consulting/audit";
import type { AuthVariables } from "@consulting/auth";
import type { Config } from "@consulting/config";
import {
  HealthResponse,
  ProblemDetailsSchema,
  ReadyResponse,
  VersionResponse,
} from "@consulting/contracts";
import { exampleRoutes } from "@consulting/module-example";
import {
  type ApiKeyRepository,
  createOrganizationAudit,
  createOrganizationRoutes,
  createTenancyService,
  type InvitationRepository,
  type MembershipRepository,
  type OrganizationRepository,
  type UnitOfWork,
} from "@consulting/module-organizations";
import { apiReference } from "@scalar/hono-api-reference";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { describeRoute, openAPIRouteHandler, resolver } from "hono-openapi";
import { z } from "zod";

import { type RoleResolver, requirePermission } from "./http/authorization";

const problem = { "application/problem+json": { schema: resolver(ProblemDetailsSchema) } };

function errorResponses() {
  return {
    400: { description: "Validation failed", content: problem },
    500: { description: "Internal error", content: problem },
  };
}

function protectedResponses() {
  return {
    ...errorResponses(),
    401: { description: "Missing or invalid session", content: problem },
    403: { description: "Insufficient permissions", content: problem },
  };
}

export interface OrganizationsHttpOptions {
  repositories: {
    organizations: OrganizationRepository;
    memberships: MembershipRepository;
    invitations: InvitationRepository;
    apiKeys: ApiKeyRepository;
    uow: UnitOfWork | null;
  };
  audit?: AuditLogger;
}

export function createRoutes(
  config: Config,
  options: { getRoles?: RoleResolver; organizations?: OrganizationsHttpOptions } = {},
): Hono<{ Variables: AuthVariables }> {
  const getRoles = options.getRoles ?? (async () => []);
  const app = new Hono<{ Variables: AuthVariables }>();

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

  app.route("/api/v1", exampleRoutes);

  if (options.organizations !== undefined) {
    const organizationsRoutes = createOrganizationRoutes({
      tenancy: createTenancyService(options.organizations.repositories),
      ...options.organizations.repositories,
      audit:
        options.organizations.audit === undefined
          ? null
          : createOrganizationAudit(options.organizations.audit),
    });
    app.route("/api/v1", organizationsRoutes);
  }

  app.get(
    "/api/v1/authorization/protected",
    describeRoute({
      description: "Demo route protected by the request.read permission",
      responses: {
        200: {
          description: "Email of the authenticated user",
          content: {
            "application/json": { schema: resolver(z.object({ email: z.string() })) },
          },
        },
        ...protectedResponses(),
      },
    }),
    requirePermission("request.read", getRoles),
    (c) => {
      const user = c.get("user");
      if (user === null) {
        throw new HTTPException(401);
      }
      return c.json({ email: user.email }, 200);
    },
  );

  app.get(
    "/api/v1/authorization/admin",
    describeRoute({
      description: "Demo route protected by the request.delete permission (admin only)",
      responses: {
        200: {
          description: "Email of the authenticated user",
          content: {
            "application/json": { schema: resolver(z.object({ email: z.string() })) },
          },
        },
        ...protectedResponses(),
      },
    }),
    requirePermission("request.delete", getRoles),
    (c) => {
      const user = c.get("user");
      if (user === null) {
        throw new HTTPException(401);
      }
      return c.json({ email: user.email }, 200);
    },
  );

  app.get(
    "/openapi.json",
    openAPIRouteHandler(app, {
      documentation: { info: { title: "@consulting/api", version: config.APP_VERSION } },
      exclude: ["/openapi.json", "/docs"],
    }),
  );
  app.get(
    "/docs",
    apiReference({
      url: "/openapi.json",
      sources: [{ url: "/api/auth/open-api/generate-schema", title: "Auth" }],
    }),
  );

  return app;
}
