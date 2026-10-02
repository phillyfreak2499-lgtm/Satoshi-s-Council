// Run once in a separate cron service. No application/desk imports or migrations.
import pg from "pg";
import { FEEDS, ingestItems, pruneItems } from "../../src/lib/news/news.ts";
import { fetchFeed } from "../../src/lib/news/fetch.ts";

const connectionString = process.env.NEWS_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
if (!connectionString) throw new Error("Bitcoin Wire requires NEWS_DATABASE_URL or DATABASE_URL");
const client = new pg.Client({ connectionString, connectionTimeoutMillis: 5000, statement_timeout: 5000, query_timeout: 5000 });
try {
  await client.connect();
  const lock = await client.query("select pg_try_advisory_lock(7615076) as acquired");
  if (!lock.rows[0].acquired) {
    console.log("[bitcoin-wire] another poll is running; skipped");
  } else {
    const now = new Date();
    let failures = 0;
    for (const feed of FEEDS) {
      try {
        const items = await fetchFeed(feed);
        const inserted = await ingestItems(client, feed.source, items, now);
        console.log(`[bitcoin-wire] ${feed.source}: ${inserted} new items`);
      } catch (error) {
        failures++;
        console.error(`[bitcoin-wire] ${feed.source}: ${error.message}`);
      }
    }
    await pruneItems(client, now);
    // Persist successes and prune even when a publisher fails. Nonzero makes partial outages visible in cron logs.
    if (failures) process.exitCode = 1;
  }
} finally { await client.end(); }
