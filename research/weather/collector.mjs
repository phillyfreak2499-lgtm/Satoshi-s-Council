import { spec, receipt, residuals, stop } from "./store.mjs";
import { KALSHI, publicJson, marketPages } from "./http.mjs";
import {
  dayWindow,
  eventDate,
  forecastHigh,
  observationSummary,
  marketMid,
  bracketProbabilities,
  bracketContains,
  finite,
  completeBrackets,
  localClock,
} from "./model.mjs";
async function recorded(client, city, kind, url, fetchJson = publicJson) {
  const r = await fetchJson(url);
  const stamp = r.body.properties?.updateTime ?? r.body.properties?.generatedAt;
  r.sourceTime = typeof stamp === "string" && Number.isFinite(Date.parse(stamp)) ? stamp : null;
  r.id = await receipt(
    client,
    city.id,
    kind,
    url,
    { ...r.body, _transport: r.headers },
    r.at,
    r.sourceTime,
  );
  return r;
}
export async function collect(
  client,
  city,
  target,
  slot,
  now = new Date(),
  io = { publicJson, marketPages },
) {
  const win = dayWindow(target, city.standard_offset);
  const at = now.toISOString();
  const meta = await recorded(
    client,
    city,
    "series",
    KALSHI + "/series/" + city.series,
    io.publicJson,
  );
  const points = await recorded(
    client,
    city,
    "points",
    `https://api.weather.gov/points/${city.lat},${city.lon}`,
    io.publicJson,
  );
  const hourly = points.body.properties?.forecastHourly;
  if (typeof hourly !== "string") throw Error("NWS hourly endpoint unavailable");
  const forecast = await recorded(client, city, "forecast", hourly, io.publicJson);
  let observations = null;
  if (slot !== "day_ahead") {
    observations = await recorded(
      client,
      city,
      "observations",
      `https://api.weather.gov/stations/${city.station}/observations?start=${encodeURIComponent(new Date(win.start).toISOString())}&end=${encodeURIComponent(at)}&limit=500`,
      io.publicJson,
    );
    if (observations.body.pagination?.next) throw Error("observation response truncated");
  }
  const ladder = await io.marketPages(city.series, "open");
  const marketIds = [];
  for (const page of ladder.pages)
    marketIds.push(
      await receipt(
        client,
        city.id,
        "markets",
        page.url,
        { ...page.body, _transport: page.headers },
        page.at,
        null,
      ),
    );
  const markets = ladder.markets.filter((m) => eventDate(m.event_ticker, city.series) === target);
  const observation = observations
    ? observationSummary(observations.body.features ?? [], win.start, Date.parse(forecast.at))
    : { floor: null, latest: null };
  const floor = observation.floor;
  const high = forecastHigh(
    forecast.body.properties?.periods ?? [],
    win.start,
    win.end,
    slot === "day_ahead" ? null : Date.parse(forecast.at),
    floor,
  );
  const errors = await residuals(client, city.id, slot, target, forecast.at);
  const sourceOk =
    meta.body.series?.settlement_sources?.some((s) => s.name === "The Weather Company") &&
    markets.every(
      (m) =>
        m.rules_primary?.includes(city.climate) && m.rules_primary?.includes("The Weather Company"),
    );
  const captured = ladder.pages.at(-1).at;
  const clock = localClock(new Date(captured), city.zone);
  const slotHour = slot === "day_ahead" ? spec.day_ahead_hour_local : Number(slot.slice(1));
  const latestObs = observation.latest;
  const checks = {
    capture_clock: clock.hour === slotHour && clock.minute < spec.capture_grace_minutes,
    mid_quotes:
      markets.length > 0 && markets.every((m) => marketMid(m, spec.max_quote_spread_cents) != null),
    source: !!sourceOk,
    window: markets.length > 0 && markets.every((m) => Date.parse(m.close_time) === win.end),
    partition: completeBrackets(markets),
    forecast: finite(high),
    forecast_fresh:
      forecast.sourceTime != null &&
      Date.parse(forecast.at) - Date.parse(forecast.sourceTime) >= 0 &&
      Date.parse(forecast.at) - Date.parse(forecast.sourceTime) <=
        spec.max_forecast_age_hours * 3600000,
    quote_pair:
      Math.abs(Date.parse(ladder.pages.at(-1).at) - Date.parse(forecast.at)) <=
      spec.max_pair_age_seconds * 1000,
    observations:
      slot === "day_ahead" ||
      (floor != null &&
        Date.parse(forecast.at) - latestObs >= 0 &&
        Date.parse(forecast.at) - latestObs <= spec.max_observation_age_minutes * 60000),
  };
  const valid = Object.values(checks).every(Boolean);
  const normal = valid
    ? bracketProbabilities(markets, high, errors, spec.min_training_city_days)
    : null;
  const conditioned =
    valid && floor != null
      ? bracketProbabilities(markets, high, errors, spec.min_training_city_days, floor)
      : null;
  const quality = {
    valid,
    checks,
    market_receipts: marketIds,
    calibration_slot: slot,
    settlement_source: "The Weather Company",
    observation_source: "NWS",
    floor_is_not_an_arbitrage_guarantee: true,
  };
  await client.query("begin");
  try {
    const saved = await client.query(
      `insert into weather_research.snapshots(study,city,target_date,slot,captured_at,source_time,forecast_f,observation_floor_f,forecast_receipt,observation_receipt,market_receipt,training_days,quality)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) on conflict do nothing returning city`,
      [
        spec.id,
        city.id,
        target,
        slot,
        captured,
        forecast.sourceTime,
        high,
        floor,
        forecast.id,
        observations?.id ?? null,
        marketIds[0] ?? null,
        errors.length,
        quality,
      ],
    );
    if (saved.rowCount)
      for (const m of markets)
        await client.query(
          `insert into weather_research.predictions(study,city,target_date,slot,ticker,captured_at,model_p,floor_p,market_mid,market)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) on conflict do nothing`,
          [
            spec.id,
            city.id,
            target,
            slot,
            m.ticker,
            captured,
            normal?.find((r) => r.ticker === m.ticker)?.p ?? null,
            conditioned?.find((r) => r.ticker === m.ticker)?.p ?? null,
            valid ? marketMid(m, spec.max_quote_spread_cents) : null,
            m,
          ],
        );
    await client.query(
      "update weather_research.study set first_collection=coalesce(first_collection,$2),first_target_date=coalesce(first_target_date,$3) where id=$1",
      [spec.id, at, target],
    );
    await client.query("commit");
  } catch (e) {
    await client.query("rollback");
    throw e;
  }
  return { valid, training_days: errors.length, checks };
}
export async function settle(client, city, now = new Date(), io = { marketPages }) {
  const ladder = await io.marketPages(city.series, "settled", publicJson, {
    min_settled_ts: String(Math.floor(now.getTime() / 1000) - 14 * 86400),
  });
  for (const page of ladder.pages) {
    const id = await receipt(client, city.id, "settlements", page.url, page.body, page.at, null);
    for (const m of page.body.markets) {
      const target = eventDate(m.event_ticker, city.series);
      const high =
        m.expiration_value !== "" && m.expiration_value != null ? Number(m.expiration_value) : NaN;
      if (
        !target ||
        !["yes", "no"].includes(m.result) ||
        !finite(high) ||
        !Number.isInteger(high) ||
        m.is_provisional === true
      )
        continue;
      if (
        !m.rules_primary?.includes(city.climate) ||
        !m.rules_primary?.includes("The Weather Company")
      )
        continue;
      if (bracketContains(m, high) !== (m.result === "yes")) {
        await stop(client, "official outcome/strike contradiction");
        throw Error("official outcome/strike contradiction");
      }
      const old = (
        await client.query(
          "select result,official_high_f from weather_research.outcomes where study=$1 and city=$2 and target_date=$3 and ticker=$4",
          [spec.id, city.id, target, m.ticker],
        )
      ).rows[0];
      if (old && (old.result !== m.result || Number(old.official_high_f) !== high)) {
        await stop(client, "official outcome revision: manual review required");
        throw Error("official outcome revision");
      }
      await client.query(
        `insert into weather_research.outcomes(study,city,target_date,ticker,discovered_at,result,official_high_f,receipt,raw)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict do nothing`,
        [spec.id, city.id, target, m.ticker, page.at, m.result, high, id, m],
      );
    }
  }
  await client.query(
    `insert into weather_research.scores(study,city,target_date,slot,ticker,model_brier,floor_brier,market_brier,scored_at)
    select p.study,p.city,p.target_date,p.slot,p.ticker,
      power(p.model_p-case when o.result='yes' then 1 else 0 end,2),power(p.floor_p-case when o.result='yes' then 1 else 0 end,2),
      power(p.market_mid-case when o.result='yes' then 1 else 0 end,2),$3
    from weather_research.predictions p join weather_research.outcomes o using(study,city,target_date,ticker)
    where p.study=$1 and p.city=$2 and p.model_p is not null and p.market_mid is not null on conflict do nothing`,
    [spec.id, city.id, now.toISOString()],
  );
}
