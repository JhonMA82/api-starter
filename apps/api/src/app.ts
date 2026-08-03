import { type Auth, type AuthVariables, createAuth } from "@consulting/auth";
import type { Config } from "@consulting/config";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { compress } from "hono/compress";
import { cors } from "hono/cors";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";
import { timeout } from "hono/timeout";
import { notFound, onError } from "./http/errors";
import { jsonLogger } from "./http/logger";
import { createRoutes } from "./routes";

/**
 * Builds the API app with the exact middleware pipeline:
 * requestId -> jsonLogger -> secureHeaders -> cors(allowlist) -> bodyLimit(1 MiB)
 * -> timeout(10 s) -> compress -> auth session -> routes -> notFound/onError.
 */
export function createApp(
  config: Config,
  options: { auth?: Auth } = {},
): Hono<{
  Variables: AuthVariables;
}> {
  const baseURL = config.BETTER_AUTH_URL ?? config.API_BASE_URL;
  const auth =
    options.auth ??
    createAuth({
      secret: config.BETTER_AUTH_SECRET,
      baseURL,
      trustedOrigins: [...config.TRUSTED_ORIGINS, new URL(baseURL).origin],
      databaseUrl: config.DATABASE_URL,
    });
  const app = new Hono<{ Variables: AuthVariables }>();

  app.use(requestId());
  app.use(jsonLogger(config));
  app.use(secureHeaders());
  app.use(cors({ origin: config.CORS_ORIGINS }));
  app.use(bodyLimit({ maxSize: 1_048_576 }));
  app.use(timeout(10_000));
  app.use(compress());
  app.use("*", auth.sessionMiddleware);

  app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));

  app.route("/", createRoutes(config));

  app.notFound(notFound);
  app.onError(onError);

  return app;
}
