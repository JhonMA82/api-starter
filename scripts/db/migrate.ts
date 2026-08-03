import { createClient, createDb } from "@consulting/module-notes";
import { migrate } from "drizzle-orm/postgres-js/migrator";

const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl === undefined) {
  console.error("[db:migrate] DATABASE_URL is not set (see .env.example)");
  process.exit(1);
}

const client = createClient(databaseUrl);
try {
  const db = createDb(client);
  await migrate(db, {
    migrationsFolder: new URL("../../migrations", import.meta.url).pathname,
  });
  console.log("[db:migrate] migrations applied");
} finally {
  await client.end();
}
