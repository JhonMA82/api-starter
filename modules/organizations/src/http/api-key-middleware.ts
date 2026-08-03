import type { MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";

import type { VerifyApiKeyUseCase } from "../application/verify-api-key";
import type { ApiKey } from "../domain/api-key.entity";
import type { OrganizationHttpVariables } from "./tenant-middleware";

/**
 * Extends the module-local organization variables with the resolved api key.
 * Keeps the module free of @consulting/auth imports (boundary test).
 */
export interface ApiKeyMiddlewareVariables extends OrganizationHttpVariables {
  apiKey: ApiKey | null;
}

export interface ApiKeyMiddlewareDeps {
  verifyApiKey: VerifyApiKeyUseCase;
}

export const SESSION_COOKIE_NAME = "better-auth.session_token";

/**
 * Bearer-key authentication for organization-scoped consumers. Resolves the
 * Authorization header via verifyApiKey when the request carries a Bearer
 * token AND no session cookie (session auth takes precedence). Unknown,
 * expired, or revoked keys are indistinguishable: always 401. Requests
 * without an Authorization header or with a session cookie pass through with
 * apiKey left as null.
 */
export function createApiKeyMiddleware(
  deps: ApiKeyMiddlewareDeps,
): MiddlewareHandler<{ Variables: ApiKeyMiddlewareVariables }> {
  return async (c, next) => {
    c.set("apiKey", null);
    const authorization = c.req.header("authorization");
    if (authorization === undefined || !authorization.startsWith("Bearer ")) {
      await next();
      return;
    }
    const cookie = c.req.header("cookie") ?? "";
    if (cookie.includes(SESSION_COOKIE_NAME)) {
      await next();
      return;
    }
    const secret = authorization.slice("Bearer ".length).trim();
    const apiKey = await deps.verifyApiKey({ secret });
    if (apiKey === null) {
      throw new HTTPException(401);
    }
    c.set("apiKey", apiKey);
    await next();
  };
}
