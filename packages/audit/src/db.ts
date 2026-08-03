import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";

import { auditSchema } from "./audit.schema";

export type AuditDb = PostgresJsDatabase<typeof auditSchema>;

export function createAuditClient(databaseUrl: string): Sql {
  return postgres(databaseUrl, { max: 1 });
}

export function createAuditDb(client: Sql): AuditDb {
  return drizzle(client, { schema: auditSchema });
}
