import type { MiddlewareHandler } from "hono";

export const SESSION_COOKIE_NAME = "better-auth.session_token";

export type SessionResult<TUser = unknown, TSession = unknown> = {
  user: TUser;
  session: TSession;
};

export type SessionVariables<TUser = unknown, TSession = unknown> = {
  user: TUser | null;
  session: TSession | null;
};

export interface SessionResolver<TUser = unknown, TSession = unknown> {
  getSession(headers: Headers): Promise<SessionResult<TUser, TSession> | null>;
}

export function createSessionMiddleware<TUser = unknown, TSession = unknown>(
  resolver: SessionResolver<TUser, TSession>,
): MiddlewareHandler<{ Variables: SessionVariables<TUser, TSession> }> {
  return async (c, next) => {
    const cookie = c.req.header("cookie");
    const authorization = c.req.header("authorization");
    const hasCredentials =
      (cookie?.includes(SESSION_COOKIE_NAME) ?? false) ||
      (authorization?.toLowerCase().startsWith("bearer ") ?? false);

    if (!hasCredentials) {
      c.set("user", null);
      c.set("session", null);
      return next();
    }

    try {
      const session = await resolver.getSession(c.req.raw.headers);
      c.set("user", session?.user ?? null);
      c.set("session", session?.session ?? null);
    } catch {
      c.set("user", null);
      c.set("session", null);
    }

    return next();
  };
}
