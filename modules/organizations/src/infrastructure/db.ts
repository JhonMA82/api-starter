import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import {
  drizzle,
  type PostgresJsDatabase,
  type PostgresJsQueryResultHKT,
} from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";

import { apiKeys } from "./api-key.schema";
import { invitations, memberships, organizations } from "./organization.schema";
import { outboxEvents } from "./outbox.schema";

export const schema = { organizations, memberships, invitations, apiKeys, outboxEvents };
export type Db = PostgresJsDatabase<typeof schema>;
export type DbTransaction = PgTransaction<
  PostgresJsQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;
export type DbOrTransaction = Db | DbTransaction;

export function createClient(databaseUrl: string): Sql {
  return postgres(databaseUrl, { max: 1 });
}

export function createDb(client: Sql): Db {
  return drizzle(client, { schema });
}
