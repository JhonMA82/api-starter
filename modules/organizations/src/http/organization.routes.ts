import { ProblemDetailsSchema } from "@consulting/contracts";
import { buildProblemDetails, mapValidationIssues, type ValidationIssue } from "@consulting/core";
import { sValidator } from "@hono/standard-validator";
import type { Context } from "hono";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { describeRoute, resolver } from "hono-openapi";
import { z } from "zod";

import { acceptInvitationUseCase } from "../application/accept-invitation";
import { createApiKeyUseCase } from "../application/create-api-key";
import {
  type CreateOrganizationDeps,
  createOrganizationUseCase,
} from "../application/create-organization";
import { deleteOrganizationUseCase } from "../application/delete-organization";
import { inviteMemberUseCase } from "../application/invite-member";
import type { OrganizationAudit } from "../application/organization-audit";
import type {
  ApiKeyRepository,
  InvitationRepository,
  MembershipRepository,
  OrganizationRepository,
  UnitOfWork,
} from "../application/ports";
import { removeMemberUseCase } from "../application/remove-member";
import { revokeApiKeyUseCase } from "../application/revoke-api-key";
import { suspendOrganizationUseCase } from "../application/suspend-organization";
import type { TenancyService } from "../application/tenancy-service";
import { transferOwnershipUseCase } from "../application/transfer-ownership";
import type { ApiKey } from "../domain/api-key.entity";
import type { Invitation } from "../domain/invitation.entity";
import type { Membership } from "../domain/membership.entity";
import type { Organization } from "../domain/organization.entity";
import type { TenantContext } from "../domain/tenant-context";
import { toHttpException } from "./errors";
import {
  AcceptInvitationBody,
  ApiKeyResponse,
  type ApiKeyResponse as ApiKeyResponseType,
  CreateApiKeyBody,
  CreateOrganizationBody,
  InvitationResponse,
  type InvitationResponse as InvitationResponseType,
  InviteMemberBody,
  MembershipResponse,
  type MembershipResponse as MembershipResponseType,
  OrganizationResponse,
  type OrganizationResponse as OrganizationResponseType,
  TenantContextResponse,
  type TenantContextResponse as TenantContextResponseType,
  TransferOwnershipBody,
} from "./schemas";
import { createTenantContextMiddleware, type OrganizationHttpVariables } from "./tenant-middleware";

const PROBLEM_JSON = { "content-type": "application/problem+json" } as const;
const problem = { "application/problem+json": { schema: resolver(ProblemDetailsSchema) } };

function validationResponses() {
  return {
    400: { description: "Validation failed", content: problem },
    500: { description: "Internal error", content: problem },
  };
}

function sessionResponses() {
  return {
    ...validationResponses(),
    401: { description: "Missing or invalid session", content: problem },
  };
}

function tenantResponses() {
  return {
    ...sessionResponses(),
    403: {
      description: "Insufficient permissions or no access to the organization",
      content: problem,
    },
    404: { description: "Organization not found", content: problem },
  };
}

function validationErrorHandler(
  result: { success: true } | { success: false; error: readonly ValidationIssue[] },
  c: Context,
): Response | undefined {
  if (result.success) {
    return undefined;
  }
  return c.json(
    buildProblemDetails({
      status: 400,
      code: "VALIDATION_FAILED",
      errors: mapValidationIssues(result.error),
      requestId: c.get("requestId"),
      instance: c.req.path,
    }),
    400,
    PROBLEM_JSON,
  );
}

function toOrganizationResponse(org: Organization): OrganizationResponseType {
  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    status: org.status,
    createdAt: org.createdAt.toISOString(),
    updatedAt: org.updatedAt.toISOString(),
  };
}

function toMembershipResponse(membership: Membership): MembershipResponseType {
  return {
    id: membership.id,
    organizationId: membership.organizationId,
    userId: membership.userId,
    role: membership.role,
    status: membership.status,
    createdAt: membership.createdAt.toISOString(),
    updatedAt: membership.updatedAt.toISOString(),
  };
}

function toInvitationResponse(invitation: Invitation): InvitationResponseType {
  return {
    id: invitation.id,
    organizationId: invitation.organizationId,
    email: invitation.email,
    role: invitation.role,
    expiresAt: invitation.expiresAt.toISOString(),
    createdAt: invitation.createdAt.toISOString(),
  };
}

function toTenantContextResponse(tenant: TenantContext): TenantContextResponseType {
  return {
    organizationId: tenant.organizationId,
    membershipId: tenant.membershipId,
    userId: tenant.userId,
    roleIds: tenant.roleIds,
  };
}

function toApiKeyResponse(apiKey: ApiKey): ApiKeyResponseType {
  return {
    id: apiKey.id,
    organizationId: apiKey.organizationId,
    name: apiKey.name,
    prefix: apiKey.prefix,
    expiresAt: apiKey.expiresAt === null ? null : apiKey.expiresAt.toISOString(),
    revokedAt: apiKey.revokedAt === null ? null : apiKey.revokedAt.toISOString(),
    lastUsedAt: apiKey.lastUsedAt === null ? null : apiKey.lastUsedAt.toISOString(),
    createdAt: apiKey.createdAt.toISOString(),
  };
}

export interface OrganizationRoutesDeps {
  tenancy: TenancyService;
  organizations: OrganizationRepository;
  memberships: MembershipRepository;
  invitations: InvitationRepository;
  apiKeys: ApiKeyRepository;
  uow: UnitOfWork | null;
  audit: OrganizationAudit | null;
}

export function createOrganizationRoutes(
  deps: OrganizationRoutesDeps,
): Hono<{ Variables: OrganizationHttpVariables }> {
  const app = new Hono<{ Variables: OrganizationHttpVariables }>();
  const tenantContext = createTenantContextMiddleware({ tenancy: deps.tenancy });

  const createOrganizationDeps: CreateOrganizationDeps =
    deps.uow === null
      ? { organizations: deps.organizations, memberships: deps.memberships }
      : { organizations: deps.organizations, memberships: deps.memberships, uow: deps.uow };
  const createOrganization = createOrganizationUseCase(createOrganizationDeps);
  const inviteMember = inviteMemberUseCase(deps);
  const acceptInvitation = acceptInvitationUseCase(deps);
  const transferOwnership = transferOwnershipUseCase(deps);
  const suspendOrganization = suspendOrganizationUseCase(deps);
  const removeMember = removeMemberUseCase(deps);
  const deleteOrganization = deleteOrganizationUseCase(deps);
  const createApiKey = createApiKeyUseCase({
    organizations: deps.organizations,
    memberships: deps.memberships,
    apiKeys: deps.apiKeys,
    ...(deps.audit === null ? {} : { audit: deps.audit }),
    ...(deps.uow === null ? {} : { uow: deps.uow }),
  });
  const revokeApiKey = revokeApiKeyUseCase({
    organizations: deps.organizations,
    memberships: deps.memberships,
    apiKeys: deps.apiKeys,
    ...(deps.audit === null ? {} : { audit: deps.audit }),
    ...(deps.uow === null ? {} : { uow: deps.uow }),
  });

  app.post(
    "/organizations",
    describeRoute({
      description: "Creates an organization owned by the authenticated user",
      responses: {
        201: {
          description: "Organization created",
          content: { "application/json": { schema: resolver(OrganizationResponse) } },
        },
        409: { description: "Slug already in use", content: problem },
        ...sessionResponses(),
      },
    }),
    sValidator("json", CreateOrganizationBody, validationErrorHandler),
    async (c) => {
      const user = c.get("user");
      if (user === null) {
        throw new HTTPException(401);
      }
      const { name, slug } = c.req.valid("json");
      try {
        const organization = await createOrganization({ name, slug, ownerUserId: user.id });
        try {
          await deps.audit?.organizationCreated(user.id, organization.id);
        } catch {
          /* audit is best-effort */
        }
        return c.json(toOrganizationResponse(organization), 201);
      } catch (error) {
        throw toHttpException(error);
      }
    },
  );

  app.get(
    "/organizations/:id",
    describeRoute({
      description:
        "Resolves and returns the caller's tenant context for the organization selected via the x-organization-id header",
      responses: {
        200: {
          description: "Tenant context of the caller within the organization",
          content: { "application/json": { schema: resolver(TenantContextResponse) } },
        },
        ...tenantResponses(),
      },
    }),
    tenantContext,
    (c) => c.json(toTenantContextResponse(c.get("tenant")), 200),
  );

  app.post(
    "/organizations/:id/invitations",
    describeRoute({
      description: "Invites a member by email; the raw one-time token is returned exactly once",
      responses: {
        201: {
          description: "Invitation created with its one-time token",
          content: {
            "application/json": {
              schema: resolver(
                z.object({ invitation: InvitationResponse, token: z.string().min(64) }),
              ),
            },
          },
        },
        ...tenantResponses(),
      },
    }),
    tenantContext,
    sValidator("json", InviteMemberBody, validationErrorHandler),
    async (c) => {
      const user = c.get("user");
      if (user === null) {
        throw new HTTPException(401);
      }
      const { email, role } = c.req.valid("json");
      try {
        const { invitation, token } = await inviteMember({
          actorUserId: user.id,
          // The route pattern guarantees the :id segment; the middleware chain
          // widens the path type so Hono's fallback overload returns string | undefined.
          organizationId: c.req.param("id") as string,
          email,
          role,
        });
        try {
          await deps.audit?.memberInvited(user.id, invitation.organizationId, email);
        } catch {
          /* audit is best-effort */
        }
        return c.json({ invitation: toInvitationResponse(invitation), token }, 201);
      } catch (error) {
        throw toHttpException(error);
      }
    },
  );

  app.post(
    "/organizations/accept-invitation",
    describeRoute({
      description: "Accepts an invitation with its one-time token and joins the organization",
      responses: {
        200: {
          description: "Membership created",
          content: { "application/json": { schema: resolver(MembershipResponse) } },
        },
        403: { description: "Organization is suspended", content: problem },
        404: { description: "Invitation not found", content: problem },
        ...sessionResponses(),
      },
    }),
    sValidator("json", AcceptInvitationBody, validationErrorHandler),
    async (c) => {
      const user = c.get("user");
      if (user === null) {
        throw new HTTPException(401);
      }
      const { token } = c.req.valid("json");
      try {
        const { membership, invitation } = await acceptInvitation({ token, userId: user.id });
        try {
          await deps.audit?.invitationAccepted(
            user.id,
            membership.organizationId,
            invitation.email,
          );
        } catch {
          /* audit is best-effort */
        }
        return c.json(toMembershipResponse(membership), 200);
      } catch (error) {
        throw toHttpException(error);
      }
    },
  );

  app.post(
    "/organizations/:id/ownership",
    describeRoute({
      description: "Transfers ownership of the organization to another member",
      responses: {
        200: {
          description: "Ownership transferred; previous owner demoted to admin",
          content: {
            "application/json": {
              schema: resolver(
                z.object({ previousOwner: MembershipResponse, newOwner: MembershipResponse }),
              ),
            },
          },
        },
        ...tenantResponses(),
      },
    }),
    tenantContext,
    sValidator("json", TransferOwnershipBody, validationErrorHandler),
    async (c) => {
      const user = c.get("user");
      if (user === null) {
        throw new HTTPException(401);
      }
      const { newOwnerUserId } = c.req.valid("json");
      try {
        const { previousOwner, newOwner } = await transferOwnership({
          actorUserId: user.id,
          // The route pattern guarantees the :id segment; the middleware chain
          // widens the path type so Hono's fallback overload returns string | undefined.
          organizationId: c.req.param("id") as string,
          newOwnerUserId,
        });
        try {
          await deps.audit?.ownershipTransferred(
            user.id,
            previousOwner.organizationId,
            previousOwner.userId,
            newOwner.userId,
          );
        } catch {
          /* audit is best-effort */
        }
        return c.json(
          {
            previousOwner: toMembershipResponse(previousOwner),
            newOwner: toMembershipResponse(newOwner),
          },
          200,
        );
      } catch (error) {
        throw toHttpException(error);
      }
    },
  );

  app.post(
    "/organizations/:id/suspend",
    describeRoute({
      description: "Suspends the organization; members lose access until it is reinstated",
      responses: {
        200: {
          description: "Organization suspended",
          content: { "application/json": { schema: resolver(OrganizationResponse) } },
        },
        ...tenantResponses(),
      },
    }),
    tenantContext,
    async (c) => {
      const user = c.get("user");
      if (user === null) {
        throw new HTTPException(401);
      }
      try {
        const organization = await suspendOrganization({
          actorUserId: user.id,
          // The route pattern guarantees the :id segment; the middleware chain
          // widens the path type so Hono's fallback overload returns string | undefined.
          organizationId: c.req.param("id") as string,
        });
        try {
          await deps.audit?.organizationSuspended(user.id, organization.id);
        } catch {
          /* audit is best-effort */
        }
        return c.json(toOrganizationResponse(organization), 200);
      } catch (error) {
        throw toHttpException(error);
      }
    },
  );

  app.delete(
    "/organizations/:id/members/:userId",
    describeRoute({
      description:
        "Removes a member from the organization; the last owner cannot be removed (transfer ownership first)",
      responses: {
        204: { description: "Member removed" },
        ...tenantResponses(),
      },
    }),
    tenantContext,
    async (c) => {
      const user = c.get("user");
      if (user === null) {
        throw new HTTPException(401);
      }
      try {
        await removeMember({
          actorUserId: user.id,
          // The route pattern guarantees the :id segment; the middleware chain
          // widens the path type so Hono's fallback overload returns string | undefined.
          organizationId: c.req.param("id") as string,
          targetUserId: c.req.param("userId") as string,
        });
        try {
          await deps.audit?.memberRemoved(
            user.id,
            c.req.param("id") as string,
            c.req.param("userId") as string,
          );
        } catch {
          /* audit is best-effort */
        }
        return c.body(null, 204);
      } catch (error) {
        throw toHttpException(error);
      }
    },
  );

  app.delete(
    "/organizations/:id",
    describeRoute({
      description:
        "Deletes the organization after strong confirmation; memberships and invitations cascade",
      responses: {
        204: { description: "Organization deleted" },
        ...tenantResponses(),
      },
    }),
    tenantContext,
    sValidator("query", z.object({ confirm: z.enum(["true", "false"]) }), validationErrorHandler),
    async (c) => {
      const user = c.get("user");
      if (user === null) {
        throw new HTTPException(401);
      }
      try {
        await deleteOrganization({
          actorUserId: user.id,
          // The route pattern guarantees the :id segment; the middleware chain
          // widens the path type so Hono's fallback overload returns string | undefined.
          organizationId: c.req.param("id") as string,
          confirm: c.req.valid("query").confirm === "true",
        });
        try {
          await deps.audit?.organizationDeleted(user.id, c.req.param("id") as string);
        } catch {
          /* audit is best-effort */
        }
        return c.body(null, 204);
      } catch (error) {
        throw toHttpException(error);
      }
    },
  );

  app.post(
    "/organizations/:id/api-keys",
    describeRoute({
      description:
        "Creates an organization-scoped API key; the raw secret is returned exactly once and cannot be retrieved later",
      responses: {
        201: {
          description: "API key created with its one-time secret",
          content: {
            "application/json": {
              schema: resolver(z.object({ apiKey: ApiKeyResponse, secret: z.string().min(32) })),
            },
          },
        },
        ...tenantResponses(),
      },
    }),
    tenantContext,
    sValidator("json", CreateApiKeyBody, validationErrorHandler),
    async (c) => {
      const user = c.get("user");
      if (user === null) {
        throw new HTTPException(401);
      }
      const { name, expiresAt } = c.req.valid("json");
      try {
        const { apiKey, secret } = await createApiKey({
          actorUserId: user.id,
          // The route pattern guarantees the :id segment; the middleware chain
          // widens the path type so Hono's fallback overload returns string | undefined.
          organizationId: c.req.param("id") as string,
          name,
          ...(expiresAt === undefined ? {} : { expiresAt: new Date(expiresAt) }),
        });
        return c.json({ apiKey: toApiKeyResponse(apiKey), secret }, 201);
      } catch (error) {
        throw toHttpException(error);
      }
    },
  );

  app.delete(
    "/organizations/:id/api-keys/:keyId",
    describeRoute({
      description: "Revokes an organization-scoped API key; revoked keys can never be used again",
      responses: {
        204: { description: "API key revoked" },
        ...tenantResponses(),
      },
    }),
    tenantContext,
    async (c) => {
      const user = c.get("user");
      if (user === null) {
        throw new HTTPException(401);
      }
      try {
        await revokeApiKey({
          actorUserId: user.id,
          // The route pattern guarantees the :id segment; the middleware chain
          // widens the path type so Hono's fallback overload returns string | undefined.
          organizationId: c.req.param("id") as string,
          keyId: c.req.param("keyId") as string,
        });
        return c.body(null, 204);
      } catch (error) {
        throw toHttpException(error);
      }
    },
  );

  return app;
}
