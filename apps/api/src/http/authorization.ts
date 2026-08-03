import type { AuthUser, AuthVariables } from "@consulting/auth";
import type { Actor, Permission, Role } from "@consulting/authorization";
import { authorize } from "@consulting/authorization";
import type { MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";

export type RoleResolver = (user: AuthUser) => readonly Role[] | Promise<readonly Role[]>;

/**
 * Route middleware that denies by default: unauthenticated requests get a 401
 * (UNAUTHORIZED), authenticated requests whose resolved roles do not grant the
 * permission get a 403 (FORBIDDEN), and only then does the handler run.
 */
export function requirePermission(
  permission: Permission,
  resolveRoles: RoleResolver,
): MiddlewareHandler<{ Variables: AuthVariables }> {
  return async (c, next) => {
    const user = c.get("user");
    if (user === null) {
      throw new HTTPException(401);
    }
    const roles = await resolveRoles(user);
    const actor: Actor = { id: user.id, roles };
    if (!authorize(actor, permission)) {
      throw new HTTPException(403);
    }
    await next();
  };
}
