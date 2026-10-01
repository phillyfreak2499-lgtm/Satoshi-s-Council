import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { spec, specHash, register, residuals } from "../research/weather/store.mjs";
import {
  dayWindow,
  forecastHigh,
  bracketProbabilities,
  observationFloor,
  observationSummary,
  bracketContains,
  marketMid,
  pairedCI,
} from "../research/weather/model.mjs";
import { publicJson, marketPages } from "../research/weather/http.mjs";
import { dueJobs, claimJob } from "../research/weather/runner.mjs";
import { collect, settle } from "../research/weather/collector.mjs";
import { primaryVerdict, privateReport, enforceStops } from "../research/weather/report.mjs";
import { hourlyAccuracy } from "../research/hourly/report.mjs";
function adapter(pg) {
  return {
    query: async (sql, args) => {
      if (!args && sql.includes(";")) {
        const rs = await pg.exec(sql);
        const r = rs.at(-1) ?? {};
        return { ...r, rowCount: r.affectedRows ?? r.rows?.length ?? 0 };
      }
      const r = await pg.query(sql, args);
      return { ...r, rowCount: r.affectedRows ?? r.rows?.length ?? 0 };
    },
  };
}
const markets = [
  {
    ticker: "KXHIGHNY-26OCT02-T69",
    event_ticker: "KXHIGHNY-26OCT02",
    strike_type: "less",
    cap_strike: 69,
  },
  {
    ticker: "KXHIGHNY-26OCT02-B69.5",
    event_ticker: "KXHIGHNY-26OCT02",
    strike_type: "between",
    floor_strike: 69,
    cap_strike: 70,
  },
  {
    ticker: "KXHIGHNY-26OCT02-T70",
    event_ticker: "KXHIGHNY-26OCT02",
    strike_type: "greater",
    floor_strike: 70,
  },
].map((m) => ({
  ...m,
  close_time: "2026-10-03T05:00:00Z",
  rules_primary: "CLINYC according to The Weather Company",
  yes_bid_dollars: "0.30",
  yes_ask_dollars: "0.32",
}));
const periods = Array.from({ length: 24 }, (_, i) => ({
  startTime: new Date(Date.parse("2026-10-02T05:00:00Z") + i * 3600000).toISOString(),
  endTime: new Date(Date.parse("2026-10-02T05:00:00Z") + (i + 1) * 3600000).toISOString(),
  temperature: i === 12 ? 70 : 60,
  temperatureUnit: "F",
}));

test("weather math: strict/inclusive bracket boundaries, empirical partition, QC, no hindsight and missing full-hour coverage", () => {
  const win = dayWindow("2026-10-02", -5);
  assert.equal(new Date(win.end).toISOString(), "2026-10-03T05:00:00.000Z");
  assert.equal(forecastHigh(periods, win.start, win.end), 70);
  assert.equal(forecastHigh(periods.slice(1), win.start, win.end), null);
  assert.equal(forecastHigh(periods, win.start, win.end, win.end, 70), null);
  assert.equal(forecastHigh(periods, win.start, win.end, win.start + 10 * 3600000, 75), 75);
  assert.equal(bracketContains(markets[0], 69), false);
  assert.equal(bracketContains(markets[1], 69), true);
  const p = bracketProbabilities(
    markets,
    70,
    Array.from({ length: 30 }, (_, i) => (i % 3) - 1),
    30,
  );
  assert.equal(
    p.reduce((s, r) => s + r.p, 0),
    1,
  );
  assert.equal(p[1].p, 2 / 3);
  assert.equal(bracketProbabilities(markets, 70, [0], 30), null);
  const floor = bracketProbabilities(markets, 70, Array(30).fill(-3), 30, 71);
  assert.equal(floor[2].p, 1);
  const obs = [
    {
      properties: {
        timestamp: new Date(win.start + 1000).toISOString(),
        temperature: { value: 20, unitCode: "wmoUnit:degC", qualityControl: "V" },
      },
    },
    {
      properties: {
        timestamp: new Date(win.end).toISOString(),
        temperature: { value: 40, unitCode: "wmoUnit:degC", qualityControl: "V" },
      },
    },
  ];
  assert.equal(observationFloor(obs, win.start, win.start + 60000), 68);
  assert.equal(
    marketMid({ ...markets[0], yes_bid_dollars: "0.8", yes_ask_dollars: "0.1" }, 10),
    null,
  );
  assert.equal(marketMid({ ...markets[0], yes_bid_dollars: "0", yes_ask_dollars: "0" }, 10), null);
});

test("weather schedule is civil-local/DST-aware, two clocks; GET-only allow-list, no redirects or incomplete pagination", async () => {
  const jobs = dueJobs(new Date("2026-10-01T22:05:00Z"));
  assert.deepEqual(
    jobs.filter((j) => j.slot === "day_ahead").map((j) => j.city.id),
    ["nyc", "miami"],
  );
  assert.equal(dueJobs(new Date("2026-10-01T22:15:00Z")).length, 0);
  const winter = dueJobs(new Date("2026-12-01T23:05:00Z"));
  assert.deepEqual(
    winter.filter((j) => j.slot === "day_ahead").map((j) => j.city.id),
    ["nyc", "miami"],
  );
  let called = false;
  await assert.rejects(
    publicJson("https://example.org", async () => {
      called = true;
    }),
  );
  assert.equal(called, false);
  const r = await publicJson("https://api.weather.gov/points/1,1", async (url, opts) => {
    assert.equal(opts.method, "GET");
    assert.equal(opts.redirect, "error");
    assert.equal(opts.headers.Authorization, undefined);
    return new Response('{"ok":true}');
  });
  assert.equal(r.body.ok, true);
  await assert.rejects(
    marketPages("KXHIGHNY", "open", async () => ({
      body: { markets: [], cursor: "never-ending" },
      at: new Date().toISOString(),
    })),
    /pagination incomplete/,
  );
});

test("weather real SQL: pre-registration immutable, isolated tables, no future/cross-city/slot residuals; durable job dedupe", async () => {
  const pg = new PGlite(),
    db = adapter(pg);
  try {
    await register(db);
    await register(db);
    assert.equal(
      (await db.query("select * from weather_research.study")).rows[0].spec_hash,
      specHash,
    );
    await assert.rejects(
      register({
        query: async (sql, args) =>
          sql.startsWith("select * from weather_research.study")
            ? { rows: [{ spec_hash: "changed" }] }
            : db.query(sql, args),
      }),
      /frozen spec changed/,
    );
    const job = dueJobs(new Date("2026-10-01T22:05:00Z")).find((j) => j.slot === "day_ahead");
    assert.equal(await claimJob(db, job, "2026-10-01T22:05:00Z"), true);
    assert.equal(await claimJob(db, job, "2026-10-01T22:05:01Z"), false);
    await db.query("update weather_research.jobs set state='failed'");
    assert.equal(await claimJob(db, job, "2026-10-01T22:06:00Z"), true);
    await db.query(
      `insert into weather_research.snapshots(study,city,target_date,slot,captured_at,forecast_f,training_days,quality) values($1,'nyc','2026-09-29','day_ahead','2026-09-28T22:00:00Z',70,0,'{"valid":true}')`,
      [spec.id],
    );
    await db.query(
      `insert into weather_research.outcomes(study,city,target_date,ticker,discovered_at,result,official_high_f,raw) values($1,'nyc','2026-09-29','OLD','2026-09-30T14:00:00Z','yes',72,'{}')`,
      [spec.id],
    );
    assert.deepEqual(
      await residuals(db, "nyc", "day_ahead", "2026-10-02", "2026-09-30T12:00:00Z"),
      [],
    );
    assert.deepEqual(
      await residuals(db, "nyc", "day_ahead", "2026-10-02", "2026-09-30T15:00:00Z"),
      [2],
    );
    assert.deepEqual(await residuals(db, "nyc", "h08", "2026-10-02", "2026-09-30T15:00:00Z"), []);
    assert.deepEqual(
      await residuals(db, "miami", "day_ahead", "2026-10-02", "2026-09-30T15:00:00Z"),
      [],
    );
  } finally {
    await pg.close();
  }
});

test("actual collector/scorer/report freeze asks/forecast probabilities, preserve outcome revisions; calendar cap stops", async () => {
  const pg = new PGlite(),
    db = adapter(pg),
    at = "2026-10-01T22:05:00Z";
  try {
    await register(db);
    for (let i = 1; i <= 30; i++) {
      const date = new Date(Date.parse("2026-10-01T00:00:00Z") - i * 86400000)
        .toISOString()
        .slice(0, 10);
      await db.query(
        `insert into weather_research.snapshots(study,city,target_date,slot,captured_at,forecast_f,training_days,quality) values($1,'nyc',$2,'day_ahead','2026-08-01',70,0,'{"valid":true}')`,
        [spec.id, date],
      );
      await db.query(
        `insert into weather_research.outcomes(study,city,target_date,ticker,discovered_at,result,official_high_f,raw) values($1,'nyc',$2,$3,'2026-10-01T14:00:00Z','yes',71,'{}')`,
        [spec.id, date, "OLD" + i],
      );
    }
    const io = {
      publicJson: async (url) => ({
        at,
        headers: {},
        body: url.includes("/series/")
          ? { series: { settlement_sources: [{ name: "The Weather Company" }] } }
          : url.includes("/points/")
            ? {
                properties: {
                  forecastHourly: "https://api.weather.gov/gridpoints/OKX/1,1/forecast/hourly",
                },
              }
            : { properties: { updateTime: at, periods } },
      }),
      marketPages: async () => ({
        markets,
        pages: [
          {
            url: "https://external-api.kalshi.com/trade-api/v2/markets",
            at,
            headers: {},
            body: { markets },
          },
        ],
      }),
    };
    const result = await collect(db, spec.cities[0], "2026-10-02", "day_ahead", new Date(at), io);
    assert.equal(result.valid, true);
    assert.equal(result.training_days, 30);
    await collect(db, spec.cities[0], "2026-10-02", "day_ahead", new Date(at), {
      ...io,
      publicJson: async (url) => ({ ...(await io.publicJson(url)), at: "2026-10-01T22:06:00Z" }),
    });
    const ps = (await db.query("select * from weather_research.predictions")).rows;
    assert.equal(ps.length, 3);
    assert.equal(ps.find((p) => p.ticker === markets[2].ticker).model_p, 1);
    const settled = markets.map((m) => ({
      ...m,
      result: bracketContains(m, 71) ? "yes" : "no",
      expiration_value: "71.00",
    }));
    const outcomeIO = {
      marketPages: async () => ({
        pages: [
          {
            url: "https://external-api.kalshi.com/trade-api/v2/markets",
            at: "2026-10-03T14:00:00Z",
            body: { markets: settled },
          },
        ],
      }),
    };
    await settle(db, spec.cities[0], new Date("2026-10-03T14:00:00Z"), outcomeIO);
    const r = await privateReport(db);
    assert.equal(r.public, false);
    assert.equal(r.primary.city_days, 0, "warmup is never evaluation");
    assert.equal(
      (await db.query("select count(*)::int as n from weather_research.scores")).rows[0].n,
      3,
    );
    await assert.rejects(
      settle(db, spec.cities[0], new Date("2026-10-03T15:00:00Z"), {
        marketPages: async () => ({
          pages: [
            {
              url: "https://external-api.kalshi.com/trade-api/v2/markets",
              at: "2026-10-03T15:00:00Z",
              body: {
                markets: settled.map((m) => ({
                  ...m,
                  result: bracketContains(m, 72) ? "yes" : "no",
                  expiration_value: "72",
                })),
              },
            },
          ],
        }),
      }),
      /revision/,
    );
    assert.match(
      (await db.query("select stop_reason from weather_research.study")).rows[0].stop_reason,
      /revision/,
    );
    await db.query(
      "update weather_research.study set stopped_at=null,stop_reason=null,first_collection='2026-01-01'",
    );
    await enforceStops(db, new Date("2026-10-03"));
    assert.match(
      (await db.query("select stop_reason from weather_research.study")).rows[0].stop_reason,
      /calendar cap/,
    );
  } finally {
    await pg.close();
  }
});

test("primary null decision uses independent date clusters, minimum samples, fixed meaningful improvement; equality fails", () => {
  const rows = Array.from({ length: 40 }, (_, i) =>
    spec.cities.map((c) => ({
      date: new Date(Date.UTC(2026, 7, 1 + i)).toISOString().slice(0, 10),
      city: c.id,
      delta: 0.01,
      market_brier: 0.1,
    })),
  ).flat();
  assert.equal(primaryVerdict(rows).verdict, "PASS_NULL");
  assert.equal(
    primaryVerdict(rows.map((r) => ({ ...r, delta: 0 }))).verdict,
    "KILL_NO_DEMONSTRATED_EDGE",
  );
  assert.equal(primaryVerdict(rows.slice(0, 10)).verdict, "INSUFFICIENT_SAMPLE");
  assert.equal(pairedCI(rows).dates, 40, "160 city-days are not 160 independent dates");
});

test("private hourly accuracy real SQL: NO probability semantics, fees, price bands, WAIT/pending/excluded denominators", async () => {
  const pg = new PGlite(),
    db = adapter(pg);
  try {
    await pg.exec(readFileSync("migrations/0055_desk_hour_research.sql", "utf8"));
    const columns = [
      "close_time",
      "event_ticker",
      "checkpoint",
      "decision",
      "side",
      "ask",
      "fee",
      "p_model",
      "p_market",
      "result",
      "settle_cents",
      "ev_cents",
      "graded_at",
      "as_of",
      "model_version",
      "authority",
      "expected_source",
      "features",
      "secs_left",
    ];
    const fresh = { brti: 80000, brti_age_s: 1, brti_source_age_s: 1 };
    for (const [i, side, ask, result, f] of [
      [1, "NO", 20, "NO", fresh],
      [2, "YES", 85, "NO", fresh],
      [3, "YES", 80, "YES", { ...fresh, brti_source_age_s: 99 }],
    ]) {
      const row = [
        `2026-09-28T0${i}:00:00Z`,
        "HOUR" + i,
        45,
        side,
        side,
        ask,
        2,
        0.8,
        0.2,
        result,
        result === side ? 100 : 0,
        result === side ? 100 - ask - 2 : -ask - 2,
        "2026-09-29",
        "2026-09-28",
        "hour-research-v1.0.0",
        "none",
        "cfbenchmarks-brti",
        f,
        2700,
      ];
      await db.query(
        `insert into desk_hour_shadow(${columns.join(",")}) values(${columns.map((_, i) => "$" + (i + 1)).join(",")})`,
        row,
      );
    }
    const rows = await hourlyAccuracy(db, "2026-09-30");
    const overall = rows.find((r) => r.price_band === null);
    assert.equal(Number(overall.settled), 2);
    assert.equal(Number(overall.wins), 1);
    assert.equal(Number(overall.excluded), 1);
    assert.equal(Number(overall.net_cents), -9);
    assert.equal(Number(overall.hit_rate_pct), 50);
    assert.equal(
      Number(rows.find((r) => r.price_band === "20–39¢").brier_model).toFixed(2),
      "0.04",
    );
  } finally {
    await pg.close();
  }
});

test("weather isolation: no Council imports, no public route/UI, separate schema, default-off child, no API credentials", () => {
  for (const f of readdirSync("research/weather").filter((f) => f.endsWith(".mjs"))) {
    const s = readFileSync("research/weather/" + f, "utf8");
    assert.doesNotMatch(s, /from\s+['"][^'"]*(?:src\/|desk\/|chair|paper|learner|bots|push)/);
    assert.doesNotMatch(s, /\bdesk_ledger\b|\bdesk_state\b|\/portfolio\/|KALSHI_API_KEY/);
  }
  const boot = readFileSync("server/plugins/weather-research.ts", "utf8");
  assert.match(boot, /WEATHER_RESEARCH_ENABLED !== "true"/);
  assert.match(boot, /spawn\(/);
  assert.doesNotMatch(boot, /ensureDesk|server-engine|healthz/);
  assert.doesNotMatch(readFileSync("src/components/desk/LabRoom.tsx", "utf8"), /weather/i);
  assert.equal(
    readdirSync("server/routes/api").some((f) => /weather/i.test(f)),
    false,
  );
});

test("invalid fresh observation cannot refresh a stale verified floor", () => {
  const start = Date.parse("2026-10-01T00:00:00Z");
  const features = [
    {
      properties: {
        timestamp: new Date(start + 60000).toISOString(),
        temperature: { value: 20, unitCode: "wmoUnit:degC", qualityControl: "V" },
      },
    },
    {
      properties: {
        timestamp: new Date(start + 7200000).toISOString(),
        temperature: { value: 30, unitCode: "wmoUnit:degC", qualityControl: "X" },
      },
    },
  ];
  assert.deepEqual(observationSummary(features, start, start + 7200000), {
    floor: 68,
    latest: start + 60000,
  });
});
