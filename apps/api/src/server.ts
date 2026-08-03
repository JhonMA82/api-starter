import { parseEnv } from "@consulting/config";
import { type LogEntry, serializeLog } from "@consulting/core";
import { createApp } from "./app";

/**
 * Production server entrypoint — the ONLY file that touches Bun APIs.
 * Graceful shutdown (D7): SIGTERM/SIGINT -> server.stop() (stop accepting,
 * drain in-flight) -> 10 s hard guard -> server.stop(true) -> exit 0.
 */
const config = parseEnv();

const server = Bun.serve({
  fetch: createApp(config).fetch,
  port: config.PORT,
  hostname: config.HOST,
});

function logLifecycle(level: LogEntry["level"], message: string): void {
  const entry: LogEntry & { message: string } = {
    timestamp: new Date().toISOString(),
    level,
    service: "@consulting/api",
    environment: config.APP_ENV,
    version: config.APP_VERSION,
    requestId: "server",
    route: "server",
    status: 0,
    duration: 0,
    message,
  };
  console.log(serializeLog(entry));
}

logLifecycle("info", `listening on http://${config.HOST}:${config.PORT}`);

let shuttingDown = false;

function shutdown(signal: string): void {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  logLifecycle("info", `received ${signal}; draining in-flight requests`);

  const guard = setTimeout(() => {
    logLifecycle("warn", "drain timed out after 10s; forcing shutdown");
    server.stop(true);
    process.exit(0);
  }, 10_000);

  void server.stop().then(() => {
    clearTimeout(guard);
    logLifecycle("info", "drain complete; exiting");
    process.exit(0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
