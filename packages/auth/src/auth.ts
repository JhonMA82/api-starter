import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { bearer, openAPI } from "better-auth/plugins";

import { authSchema } from "./auth.schema";
import { createAuthClient, createAuthDb } from "./db";
import { createSessionMiddleware } from "./session-middleware";

export interface AuthOptions {
  secret: string;
  baseURL: string;
  trustedOrigins: string[];
  databaseUrl: string;
}

export function createAuth(options: AuthOptions) {
  const client = createAuthClient(options.databaseUrl);
  const db = createAuthDb(client);
  const instance = betterAuth({
    secret: options.secret,
    baseURL: options.baseURL,
    trustedOrigins: options.trustedOrigins,
    database: drizzleAdapter(db, { provider: "pg", schema: authSchema }),
    emailAndPassword: { enabled: true },
    plugins: [bearer(), openAPI()],
  });

  type Session = typeof instance.$Infer.Session;
  const getSession = (headers: Headers): Promise<Session | null> =>
    instance.api.getSession({ headers });

  return {
    handler: instance.handler,
    sessionMiddleware: createSessionMiddleware<Session["user"], Session["session"]>({
      getSession,
    }),
    getSession,
    close: () => client.end(),
  };
}

export type Auth = ReturnType<typeof createAuth>;
export type AuthSessionResult = Awaited<ReturnType<Auth["getSession"]>>;
export type AuthUser = NonNullable<AuthSessionResult>["user"];
export type AuthSession = NonNullable<AuthSessionResult>["session"];
export type AuthVariables = {
  user: AuthUser | null;
  session: AuthSession | null;
};
