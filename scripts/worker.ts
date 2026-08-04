import {
  createClient,
  createDb,
  createOutboxRepository,
  createOutboxWorker,
  createWebhookDeliverer,
  createWebhookOutboxHandler,
  createWebhookRepository,
  defaultWebhookDeliver,
} from "@consulting/module-organizations";

/**
 * Standalone outbox worker (compose profile `worker`, spec §23.2). Polls the
 * transactional outbox and fans events out to subscribed webhook endpoints.
 * Graceful shutdown (§23.5): SIGTERM/SIGINT stop the poll loop, wait for the
 * in-flight poll, close the DB client and exit 0 within a 10 s guard.
 */
const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl === undefined) {
  console.error("[worker] DATABASE_URL is not set (see .env.example)");
  process.exit(1);
}

const rawInterval = process.env.OUTBOX_POLL_INTERVAL_MS ?? "5000";
const pollIntervalMs = Number(rawInterval);
if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 100) {
  console.error(
    `[worker] OUTBOX_POLL_INTERVAL_MS must be an integer >= 100 (got "${rawInterval}")`,
  );
  process.exit(1);
}

const client = createClient(databaseUrl);
const db = createDb(client);
const outbox = createOutboxRepository(db);
const webhooks = createWebhookRepository(db);
const deliverer = createWebhookDeliverer({ webhooks, deliver: defaultWebhookDeliver });
const worker = createOutboxWorker({
  outbox,
  handlers: createWebhookOutboxHandler({ webhooks, deliverer }),
});

let stopping = false;
let polling = false;

function log(message: string): void {
  console.log(`[worker] ${message}`);
}

async function pollOnce(): Promise<void> {
  const result = await worker.poll(10);
  if (result.processed > 0) {
    log(
      `poll: processed=${result.processed} succeeded=${result.succeeded} failed=${result.failed}`,
    );
  }
}

async function run(): Promise<void> {
  log(`outbox worker started (poll interval ${pollIntervalMs}ms)`);
  while (!stopping) {
    polling = true;
    try {
      await pollOnce();
    } catch (error) {
      console.error(
        `[worker] poll error: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      polling = false;
    }
    let waited = 0;
    while (!stopping && waited < pollIntervalMs) {
      await Bun.sleep(100);
      waited += 100;
    }
  }
}

let shuttingDown = false;

function shutdown(signal: string): void {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  stopping = true;
  log(`received ${signal}; stopping poll loop and draining in-flight poll`);

  const guard = setTimeout(() => {
    console.error("[worker] drain timed out after 10s; forcing shutdown");
    process.exit(1);
  }, 10_000);

  void (async () => {
    while (polling) {
      await Bun.sleep(50);
    }
    clearTimeout(guard);
    try {
      await client.end();
      log("db client closed; exiting");
      process.exit(0);
    } catch (error) {
      console.error(
        `[worker] db client close failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exit(1);
    }
  })();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

void run();
