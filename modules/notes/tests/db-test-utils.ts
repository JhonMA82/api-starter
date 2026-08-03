import { migrate } from "drizzle-orm/postgres-js/migrator";
import type { Sql } from "postgres";
import { createClient, createDb } from "../src";

export function getDatabaseUrl(): string | null {
  return Bun.env.DATABASE_URL ?? null;
}

export function createTestClient(url: string): Sql {
  return createClient(url);
}

export async function resetDatabase(client: Sql): Promise<void> {
  await client.unsafe("DROP SCHEMA IF EXISTS drizzle CASCADE");
  await client.unsafe("DROP SCHEMA IF EXISTS public CASCADE");
  await client.unsafe("CREATE SCHEMA public");
}

export async function migrateToLatest(client: Sql): Promise<void> {
  await migrate(createDb(client), {
    migrationsFolder: new URL("../../../migrations", import.meta.url).pathname,
  });
}

export async function closeClient(client: Sql): Promise<void> {
  await client.end();
}
