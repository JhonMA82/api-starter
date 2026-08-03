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
 * -> timeout(10 s) -> compress -> routes -> notFound/onError.
 */
export function createApp(config: Config): Hono {
  const app = new Hono();

  app.use(requestId());
  app.use(jsonLogger(config));
  app.use(secureHeaders());
  app.use(cors({ origin: config.CORS_ORIGINS }));
  app.use(bodyLimit({ maxSize: 1_048_576 }));
  app.use(timeout(10_000));
  app.use(compress());

  app.route("/", createRoutes(config));

  app.notFound(notFound);
  app.onError(onError);

  return app;
}
