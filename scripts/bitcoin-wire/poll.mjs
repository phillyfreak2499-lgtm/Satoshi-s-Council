// The existing cron collects both context feeds; no application/desk imports.
import pg from "pg";
import { collectGroup } from "../../src/lib/news/collect.ts";

const connectionString = process.env.NEWS_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
if (!connectionString) throw new Error("Bitcoin Wire requires NEWS_DATABASE_URL or DATABASE_URL");
async function pollGroup(tag, lockId) {
  // Separate connections and locks: a bad publisher or group cannot wedge its peer.
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 5000, statement_timeout: 5000, query_timeout: 5000 });
  try {
    await client.connect();
    const lock = await client.query("select pg_try_advisory_lock($1) as acquired", [lockId]);
    if (!lock.rows[0].acquired) {
      console.log(`[bitcoin-wire/${tag}] another poll is running; skipped`);
      return 0;
    }
    return await collectGroup(client, tag, new Date());
  } finally { await client.end(); }
}
const results = await Promise.allSettled([pollGroup("btc", 7615076), pollGroup("ai", 7615077)]);
results.forEach((result, index) => {
  if (result.status === "rejected") {
    console.error(`[bitcoin-wire/${index === 0 ? "btc" : "ai"}] ${result.reason?.message ?? "collection failed"}`);
    process.exitCode = 1;
  } else if (result.value) process.exitCode = 1;
});
