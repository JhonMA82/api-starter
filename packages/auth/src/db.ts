import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";

import { authSchema } from "./auth.schema";

export type AuthDb = PostgresJsDatabase<typeof authSchema>;

export function createAuthClient(databaseUrl: string): Sql {
  return postgres(databaseUrl, { max: 1 });
}

export function createAuthDb(client: Sql): AuthDb {
  return drizzle(client, { schema: authSchema });
}
