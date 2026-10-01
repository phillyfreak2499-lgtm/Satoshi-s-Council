/** Private read-only report. Does not import, start or alter any Council module. */
import pg from "pg";
import { readFile } from "node:fs/promises";
export async function hourlyAccuracy(client, cutoff = new Date().toISOString()) {
  return (
    await client.query(await readFile(new URL("./accuracy.sql", import.meta.url), "utf8"), [cutoff])
  ).rows;
}
if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  if (!process.env.DATABASE_URL) throw Error("DATABASE_URL required; no fallback");
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    application_name: "hourly-private-report",
    statement_timeout: 15000,
  });
  try {
    await client.connect();
    await client.query("begin read only");
    console.log(
      JSON.stringify(
        {
          authority: "none",
          sides: "YES/NO against the named strike; not BTC UP/DOWN",
          cutoff: process.argv[2] ?? new Date().toISOString(),
          rows: await hourlyAccuracy(client, process.argv[2]),
        },
        null,
        2,
      ),
    );
  } finally {
    await client.end();
  }
}
