import { Pool } from "pg";

// Independent one-connection pool; never imports or alters the desk pool/runtime.
let pool: Pool | undefined;
export function newsDatabase(): Pool {
  const connectionString = process.env.NEWS_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error("Bitcoin Wire database is not configured");
  if (!pool) {
    pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000, statement_timeout: 5000, query_timeout: 5000, idleTimeoutMillis: 10000, allowExitOnIdle: true });
    pool.on("error", () => console.error("[bitcoin-wire] idle database connection failed"));
  }
  return pool;
}
