import { createClient, createDb, seedNotes } from "@consulting/module-notes";
import { migrate } from "drizzle-orm/postgres-js/migrator";

const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl === undefined) {
  console.error("[db:seed] DATABASE_URL is not set (see .env.example)");
  process.exit(1);
}

const client = createClient(databaseUrl);
try {
  const db = createDb(client);
  await migrate(db, {
    migrationsFolder: new URL("../../migrations", import.meta.url).pathname,
  });
  const inserted = await seedNotes(db);
  console.log(`[db:seed] ${inserted} note(s) inserted (0 on re-run — idempotent)`);
} finally {
  await client.end();
}
