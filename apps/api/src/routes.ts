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
  createFileRoutes,
  type FileHashing,
  type FileRepository,
  type FileStorage,
  type MembershipGuard,
} from "@consulting/module-files";
import type { JobQueue } from "@consulting/module-organizations";
import {
  type ApiKeyRepository,
  createIncomingWebhookRoutes,
  createOrganizationAudit,
  createOrganizationRoutes,
  createReceiveIncomingWebhookUseCase,
  createTenancyService,
  createTenantContextMiddleware,
  type IncomingWebhookRepository,
  type InvitationRepository,
  type MembershipRepository,
  type OrganizationRepository,
  type UnitOfWork,
  type WebhookProviderSecrets,
  type WebhookRepository,
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
    webhooks: WebhookRepository;
    uow: UnitOfWork | null;
  };
  audit?: AuditLogger;
  /**
   * Incoming webhook receiver wiring (spec §14.6). When absent the
   * /api/v1/webhooks/incoming/* routes are NOT mounted (hermetic default).
   */
  incomingWebhooks?: {
    repository: IncomingWebhookRepository;
    secrets: WebhookProviderSecrets;
    queue: JobQueue | null;
  };
}

/**
 * Files HTTP wiring (spec §15). Requires the organizations wiring: the
 * MembershipGuard and the tenant middleware are built from the organizations
 * tenancy service (assertCanManage = resolveTenantContext). When absent the
 * /api/v1/files* routes are NOT mounted (hermetic default).
 */
export interface FilesHttpOptions {
  files: FileRepository;
  storage: FileStorage;
  hash: FileHashing;
  /** HMAC secret for signed download tokens. */
  signedUrlSecret: string;
  /** Public API origin used to build download links. */
  baseUrl: string;
  /** Upload size cap in bytes; defaults to MAX_FILE_SIZE_BYTES (10 MiB). */
  maxUploadBytes?: number;
  /**
   * Optional overrides for hermetic tests. Defaults: a guard that asserts via
   * the organizations tenancy (resolveTenantContext) and the real tenant
   * context middleware built from the same tenancy service.
   */
  guard?: MembershipGuard;
  tenantContext?: ReturnType<typeof createTenantContextMiddleware>;
}

export function createRoutes(
  config: Config,
  options: {
    getRoles?: RoleResolver;
    organizations?: OrganizationsHttpOptions;
    files?: FilesHttpOptions;
  } = {},
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

  // Incoming webhooks mount OUTSIDE the tenant/session middleware chain:
  // public by design — the HMAC signature is the authentication.
  if (options.organizations?.incomingWebhooks !== undefined) {
    const incomingWebhookRoutes = createIncomingWebhookRoutes({
      receive: createReceiveIncomingWebhookUseCase({
        incomingWebhooks: options.organizations.incomingWebhooks.repository,
        secrets: options.organizations.incomingWebhooks.secrets,
        queue: options.organizations.incomingWebhooks.queue,
        ...(options.organizations.audit === undefined
          ? {}
          : { audit: options.organizations.audit }),
      }),
    });
    app.route("/api/v1", incomingWebhookRoutes);
  }

  // Files mount with the guard built from the organizations tenancy; the
  // public download route (HMAC-signed token) is part of the same router.
  if (options.files !== undefined) {
    if (options.organizations === undefined) {
      throw new Error("files routes require the organizations wiring");
    }
    const tenancy = createTenancyService(options.organizations.repositories);
    const guard: MembershipGuard =
      options.files.guard ??
      ({
        assertCanManage: async (actorUserId: string, organizationId: string) => {
          await tenancy.resolveTenantContext({ organizationId, userId: actorUserId });
        },
      } satisfies MembershipGuard);
    const fileRoutes = createFileRoutes({
      guard,
      files: options.files.files,
      storage: options.files.storage,
      hash: options.files.hash,
      signedUrlSecret: options.files.signedUrlSecret,
      baseUrl: options.files.baseUrl,
      ...(options.files.maxUploadBytes === undefined
        ? {}
        : { maxUploadBytes: options.files.maxUploadBytes }),
      tenantContext: options.files.tenantContext ?? createTenantContextMiddleware({ tenancy }),
    });
    app.route("/api/v1", fileRoutes);
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
