/** Standalone private scheduler. No app imports, HTTP routes, alerts or trading API. */
import pg from "pg";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { spec, register, stop } from "./store.mjs";
import { localClock, addDay } from "./model.mjs";
import { collect, settle } from "./collector.mjs";
import { enforceStops, privateReport } from "./report.mjs";
export function dueJobs(now = new Date()) {
  return spec.cities.flatMap((city) => {
    const p = localClock(now, city.zone);
    if (p.minute >= spec.capture_grace_minutes) return [];
    const out = [];
    if (p.hour === spec.day_ahead_hour_local)
      out.push({ city, slot: "day_ahead", date: p.date, target: addDay(p.date) });
    if (spec.same_day_hours_local.includes(p.hour))
      out.push({ city, slot: `h${String(p.hour).padStart(2, "0")}`, date: p.date, target: p.date });
    if (p.hour === spec.nightly_hour_local)
      out.push({ city, slot: "nightly", date: p.date, target: p.date });
    return out;
  });
}
export async function claimJob(client, job, at) {
  return (
    (
      await client.query(
        `insert into weather_research.jobs(study,city,slot,scheduled_date,started_at,state)
    values($1,$2,$3,$4,$5,'running') on conflict(study,city,slot,scheduled_date) do update
    set started_at=excluded.started_at,state='running',detail=null
    where weather_research.jobs.state='failed' or (weather_research.jobs.state='running' and weather_research.jobs.started_at<excluded.started_at-interval '5 minutes') returning city`,
        [spec.id, job.city.id, job.slot, job.date, at],
      )
    ).rowCount === 1
  );
}
export async function cycle(
  client,
  now = new Date(),
  operations = { collect, settle, enforceStops },
) {
  const registered = await register(client);
  if (registered.stopped_at) return;
  await operations.enforceStops(client, now);
  if ((await client.query("select stopped_at from weather_research.study where id=$1", [spec.id])).rows[0]?.stopped_at) return;
  if (
    registered.first_collection &&
    (now - Date.parse(registered.first_collection)) / 86400000 >= spec.max_calendar_days
  ) {
    await stop(client, "calendar cap: stop, no extension");
    return;
  }
  let nightly = false;
  for (const job of dueJobs(now)) {
    if (
      (await client.query("select stopped_at from weather_research.study where id=$1", [spec.id]))
        .rows[0]?.stopped_at
    )
      break;
    const at = new Date().toISOString();
    if (!(await claimJob(client, job, at))) continue;
    if (job.slot === "nightly") nightly = true;
    else
      await client.query(
        "update weather_research.study set first_collection=coalesce(first_collection,$2),first_target_date=coalesce(first_target_date,$3) where id=$1",
        [spec.id, at, job.target],
      );
    try {
      const detail =
        job.slot === "nightly"
          ? await operations.settle(client, job.city, now)
          : await operations.collect(client, job.city, job.target, job.slot, now);
      await client.query(
        `update weather_research.jobs set state='complete',finished_at=now(),detail=$5 where study=$1 and city=$2 and slot=$3 and scheduled_date=$4`,
        [spec.id, job.city.id, job.slot, job.date, JSON.stringify(detail ?? {})],
      );
    } catch (error) {
      await client.query(
        `update weather_research.jobs set state='failed',finished_at=now(),detail=$5 where study=$1 and city=$2 and slot=$3 and scheduled_date=$4`,
        [spec.id, job.city.id, job.slot, job.date, String(error).slice(0, 1000)],
      );
      console.error("weather private job failed", job.city.id, job.slot, String(error));
    }
    await operations.enforceStops(client, now);
  }
  if (nightly) await operations.enforceStops(client, now);
}
async function main() {
  const mode = process.argv[2];
  if (!["--install", "--once", "--daemon", "--report"].includes(mode))
    throw Error("use --install, --once, --daemon, or --report");
  if (!process.env.DATABASE_URL) throw Error("DATABASE_URL required; no fallback database");
  if (
    mode !== "--install" &&
    mode !== "--report" &&
    process.env.WEATHER_RESEARCH_ENABLED !== "true"
  )
    throw Error("weather collection is disabled");
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    application_name: "weather-research-private",
    statement_timeout: 15000,
    connectionTimeoutMillis: 10000,
  });
  await client.connect();
  let timer;
  try {
    if (mode === "--report") {
      await client.query("begin read only");
      console.log(JSON.stringify(await privateReport(client), null, 2));
      return;
    }
    const locked = (await client.query("select pg_try_advisory_lock(1464156500,387385) as locked"))
      .rows[0].locked;
    if (!locked) throw Error("another weather runner owns the private lock");
    await register(client);
    if (mode === "--install") {
      console.log(JSON.stringify({ registered: spec.id, collection: false }));
      return;
    }
    let busy = false;
    const run = async () => {
      if (busy) return;
      busy = true;
      const deadline = setTimeout(() => {
        console.error("weather cycle deadline exceeded");
        process.exitCode = 1;
        void client.end().finally(() => process.exit(1));
      }, spec.cycle_timeout_ms);
      try {
        await cycle(client);
      } catch (e) {
        console.error("weather private cycle failed", String(e));
      } finally {
        clearTimeout(deadline);
        busy = false;
      }
    };
    await run();
    if (mode === "--once") return;
    timer = setInterval(() => void run(), 60000);
    await new Promise((resolve) => {
      process.once("SIGTERM", resolve);
      process.once("SIGINT", resolve);
    });
  } finally {
    clearInterval(timer);
    await client.end();
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  void main().catch((e) => {
    console.error(String(e));
    process.exitCode = 1;
  });
