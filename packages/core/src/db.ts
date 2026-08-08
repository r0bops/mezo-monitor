import pg from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema>;

export type DbClient = {
  pool: pg.Pool;
  db: Database;
};

/** Create a pooled Drizzle client. Reads DATABASE_URL unless given. */
export function createDb(connectionString: string = process.env.DATABASE_URL ?? ""): DbClient {
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set (check your .env)");
  }
  const pool = new pg.Pool({ connectionString });
  const db = drizzle(pool, { schema });
  return { pool, db };
}
