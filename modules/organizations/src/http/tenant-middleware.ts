import type { MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";

import type { TenancyService } from "../application/tenancy-service";
import type { TenantContext } from "../domain/tenant-context";
import { toHttpException } from "./errors";

/**
 * Structural stand-in for the app's auth session variables. The module must not
 * import @consulting/auth (boundary test), so the middleware types only the
 * fields it reads from the session middleware and the tenant context it sets.
 */
export interface OrganizationHttpVariables {
  user: { id: string; email: string } | null;
  session: unknown;
  requestId: string;
  tenant: TenantContext;
}

export interface TenantMiddlewareDeps {
  tenancy: TenancyService;
}

export const ORGANIZATION_ID_HEADER = "x-organization-id";

/**
 * Tenant resolution for organization-scoped routes. Reads the session user and
 * the x-organization-id header, resolves the tenant context, and stores it as
 * c.tenant. Errors never leak existence of other organizations: unknown
 * organizations are 404, while suspended organizations and missing/inactive
 * memberships are 403.
 */
export function createTenantContextMiddleware(
  deps: TenantMiddlewareDeps,
): MiddlewareHandler<{ Variables: OrganizationHttpVariables }> {
  return async (c, next) => {
    const user = c.get("user");
    if (user === null) {
      throw new HTTPException(401);
    }
    const organizationId = c.req.header(ORGANIZATION_ID_HEADER);
    if (organizationId === undefined || organizationId.trim() === "") {
      throw new HTTPException(400);
    }
    try {
      c.set("tenant", await deps.tenancy.resolveTenantContext({ organizationId, userId: user.id }));
    } catch (error) {
      throw toHttpException(error);
    }
    await next();
  };
}
