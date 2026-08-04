import { type Auth, type AuthVariables, createAuth } from "@consulting/auth";
import type { Config } from "@consulting/config";
import { createMetricsRegistry, type MetricsRegistry, type Tracer } from "@consulting/core";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { compress } from "hono/compress";
import { cors } from "hono/cors";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";
import { timeout } from "hono/timeout";
import type { RoleResolver } from "./http/authorization";
import { notFound, onError } from "./http/errors";
import { jsonLogger } from "./http/logger";
import { createMetricsMiddleware } from "./http/metrics";
import { createRoutes, type FilesHttpOptions, type OrganizationsHttpOptions } from "./routes";

/**
 * Builds the API app with the exact middleware pipeline:
 * requestId -> jsonLogger -> metrics -> secureHeaders -> cors(allowlist) ->
 * bodyLimit(1 MiB, except POST /api/v1/files, which enforces its own cap) ->
 * timeout(10 s) -> compress -> auth session -> routes -> notFound/onError.
 *
 * Options:
 * - `metrics`: registry backing GET /metrics (spec §22). Defaults to an
 *   internal instance when omitted. To poll the registry programmatically
 *   (e.g. shutdown stats), construct it first and pass it in.
 * - `tracer`: decoupled tracer contract (§22.3, no provider shipped). When
 *   provided, each request gets a span and its traceId lands in the log
 *   entry; a provider adapter can implement `Tracer` later.
 */
export function createApp(
  config: Config,
  options: {
    auth?: Auth;
    getRoles?: RoleResolver;
    organizations?: OrganizationsHttpOptions;
    files?: FilesHttpOptions;
    metrics?: MetricsRegistry;
    tracer?: Tracer;
  } = {},
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
  const getRoles: RoleResolver = options.getRoles ?? (async () => []);
  const metrics = options.metrics ?? createMetricsRegistry();
  const app = new Hono<{ Variables: AuthVariables }>();

  const MAX_BODY_BYTES = 1_048_576;
  const FILE_UPLOAD_PATH = "/api/v1/files";

  /**
   * App-wide body cap of 1 MiB, except POST /api/v1/files: multipart uploads
   * legitimately exceed 1 MiB, so the upload route enforces its own cap
   * (10 MiB by default in modules/files). hono's bodyLimit has no path
   * exclusion, so the upload path skips the app-wide middleware.
   */
  function bodyLimitExceptUpload(maxSize: number): MiddlewareHandler {
    return (c, next) =>
      c.req.method === "POST" && c.req.path === FILE_UPLOAD_PATH
        ? next()
        : bodyLimit({ maxSize })(c, next);
  }

  app.use(requestId());
  app.use(jsonLogger(config, options.tracer));
  app.use(createMetricsMiddleware(metrics));
  app.use(secureHeaders());
  app.use(cors({ origin: config.CORS_ORIGINS }));
  app.use(bodyLimitExceptUpload(MAX_BODY_BYTES));
  app.use(timeout(10_000));
  app.use(compress());
  app.use("*", auth.sessionMiddleware);

  app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));

  app.route(
    "/",
    createRoutes(config, {
      getRoles,
      metrics,
      ...(options.organizations === undefined ? {} : { organizations: options.organizations }),
      ...(options.files === undefined ? {} : { files: options.files }),
    }),
  );

  app.notFound(notFound);
  app.onError(onError);

  return app;
}
