import { spec, stop } from "./store.mjs";
import { pairedCI } from "./model.mjs";
export async function scoredUnits(client) {
  return (
    await client.query(
      `select p.city,p.target_date::text as date,p.slot,
    avg(s.market_brier-s.model_brier) as delta,avg(s.market_brier) as market_brier,
    avg(s.model_brier) as model_brier,avg(s.market_brier-s.floor_brier) as floor_delta,
    count(*) as brackets,
    avg(s.market_brier-s.model_brier) filter(where p.market_mid <= $2) as low_tail_delta,
    avg(s.market_brier-s.model_brier) filter(where p.market_mid >= $3) as high_tail_delta,
    avg(case when o.result='yes' then 1 else 0 end-p.market_mid) filter(where p.market_mid <= $2) as low_tail_mispricing,
    avg(case when o.result='yes' then 1 else 0 end-p.market_mid) filter(where p.market_mid >= $3) as high_tail_mispricing,
    avg(s.market_brier-s.model_brier) filter(where p.market_mid <= $2 or p.market_mid >= $3) as tail_delta,
    count(*) filter(where p.market_mid <= $2 or p.market_mid >= $3) as tail_brackets
    from weather_research.predictions p join weather_research.scores s using(study,city,target_date,slot,ticker) join weather_research.outcomes o using(study,city,target_date,ticker)
    where p.study=$1 group by p.city,p.target_date,p.slot
    having count(*)=(select count(*) from weather_research.predictions q where q.study=$1 and q.city=p.city and q.target_date=p.target_date and q.slot=p.slot)
    order by p.target_date,p.city,p.slot`,
      [spec.id, spec.tail_mid_low, spec.tail_mid_high],
    )
  ).rows.map((r) => ({
    ...r,
    delta: Number(r.delta),
    market_brier: Number(r.market_brier),
    model_brier: Number(r.model_brier),
    floor_delta: r.floor_delta == null ? null : Number(r.floor_delta),
    tail_delta: r.tail_delta == null ? null : Number(r.tail_delta),
  }));
}
export function primaryVerdict(rows) {
  const dates = new Set(rows.map((r) => r.date));
  const cities = spec.cities.map((c) => ({
    city: c.id,
    n: rows.filter((r) => r.city === c.id).length,
  }));
  const enough =
    dates.size >= spec.min_evaluation_dates &&
    rows.length >= spec.min_evaluation_city_days &&
    cities.every((c) => c.n >= spec.min_evaluation_per_city);
  const ci = pairedCI(rows, spec.bootstrap_replicates, spec.bootstrap_seed);
  const marketByDate = [...dates].map((date) => {
    const rs = rows.filter((r) => r.date === date);
    return rs.reduce((s, r) => s + r.market_brier, 0) / rs.length;
  });
  const market = marketByDate.length
    ? marketByDate.reduce((s, x) => s + x, 0) / marketByDate.length
    : null;
  const relative = ci && market > 0 ? ci.mean / market : null;
  return {
    city_days: rows.length,
    dates: dates.size,
    by_city: cities,
    ci,
    relative_improvement: relative,
    verdict: !enough
      ? "INSUFFICIENT_SAMPLE"
      : ci?.lower > 0 && relative >= spec.primary_relative_brier_improvement
        ? "PASS_NULL"
        : "KILL_NO_DEMONSTRATED_EDGE",
  };
}
export async function enforceStops(client, now = new Date()) {
  const study = (await client.query("select * from weather_research.study where id=$1", [spec.id]))
    .rows[0];
  if (!study || study.stopped_at || !study.first_collection) return;
  const stored = Number(
    (
      await client.query(
        "select coalesce(sum(pg_column_size(body)),0) as bytes from weather_research.receipts where study=$1",
        [spec.id],
      )
    ).rows[0].bytes,
  );
  if (stored > spec.max_raw_storage_bytes) {
    await stop(client, "raw storage budget exceeded");
    return;
  }
  const elapsed = (now - Date.parse(study.first_collection)) / 86400000;
  if (elapsed >= spec.max_calendar_days) {
    await stop(client, "calendar cap: stop, no extension");
    return;
  }
  // Coverage measures valid frozen day-ahead snapshots, not HTTP attempts or warmup probabilities.
  const coverage = (
    await client.query(
      `select min(target_date)::text as first_date,count(*) filter(where quality->>'valid'='true')::int as valid from weather_research.snapshots where study=$1 and slot='day_ahead' and target_date < $2::date`,
      [spec.id, now.toISOString().slice(0, 10)],
    )
  ).rows[0];
  const firstTarget = study.first_target_date
    ? new Date(study.first_target_date).toISOString().slice(0, 10)
    : coverage.first_date;
  const days = firstTarget
    ? Math.floor((Date.parse(now.toISOString().slice(0, 10)) - Date.parse(firstTarget)) / 86400000)
    : 0;
  if (
    days >= spec.coverage_check_after_days &&
    Number(coverage.valid) / (days * spec.cities.length) < spec.minimum_capture_coverage
  ) {
    await stop(client, "capture coverage below frozen 80% requirement");
    return;
  }
  const units = await scoredUnits(client);
  if (!study.evaluation_start) {
    const mature = units.filter((r) => r.slot === "day_ahead");
    // First model-scored unit is after the required 30 city-specific historical errors.
    const starts = spec.cities.map(
      (c) =>
        mature
          .filter((r) => r.city === c.id)
          .map((r) => r.date)
          .sort()[0],
    );
    if (starts.every(Boolean))
      await client.query(
        "update weather_research.study set evaluation_start=$2 where id=$1 and evaluation_start is null",
        [spec.id, starts.sort().at(-1)],
      );
    return;
  }
  const start = new Date(study.evaluation_start).toISOString().slice(0, 10);
  const end = new Date(Date.parse(start) + spec.evaluation_days * 86400000)
    .toISOString()
    .slice(0, 10);
  // Give official labels their contractual delay; bounded by the calendar cap.
  if (now.getTime() < Date.parse(end) + 7 * 86400000) return;
  const primary = primaryVerdict(
    units.filter((r) => r.slot === "day_ahead" && r.date >= start && r.date < end),
  );
  await stop(
    client,
    primary.verdict === "PASS_NULL"
      ? "primary complete: PASS_NULL; private secondary review only"
      : primary.verdict,
  );
}
export async function privateReport(client) {
  const study =
    (await client.query("select * from weather_research.study where id=$1", [spec.id])).rows[0] ??
    null;
  const units = await scoredUnits(client);
  const start = study?.evaluation_start
    ? new Date(study.evaluation_start).toISOString().slice(0, 10)
    : null;
  const end = start
    ? new Date(Date.parse(start) + spec.evaluation_days * 86400000).toISOString().slice(0, 10)
    : null;
  const eligible = start ? units.filter((r) => r.date >= start && r.date < end) : [];
  const primary = primaryVerdict(eligible.filter((r) => r.slot === "day_ahead"));
  const formal =
    !!study?.stopped_at &&
    primary.verdict === "PASS_NULL" &&
    study.stop_reason.startsWith("primary complete");
  return {
    study,
    authority: "none",
    paper: false,
    public: false,
    primary: { ...primary, provisional: !study?.stopped_at, decision_allowed: formal },
    same_day_by_hour: spec.same_day_hours_local.map((h) => {
      const xs = eligible.filter((r) => r.slot === `h${String(h).padStart(2, "0")}`);
      const floor = xs
        .filter((r) => r.floor_delta != null)
        .map((r) => ({ ...r, delta: r.floor_delta }));
      const enough =
        floor.length >= spec.secondary_min_city_days &&
        new Set(floor.map((r) => r.date)).size >= spec.secondary_min_dates;
      const floorMid = pairedCI(
        floor,
        spec.bootstrap_replicates,
        spec.bootstrap_seed,
        spec.secondary_family_alpha / spec.secondary_same_day_tests,
      );
      const floorForecast = pairedCI(
        floor.map((r) => ({
          ...r,
          delta: r.delta - xs.find((x) => x.city === r.city && x.date === r.date).delta,
        })),
        spec.bootstrap_replicates,
        spec.bootstrap_seed,
        spec.secondary_family_alpha / spec.secondary_same_day_tests,
      );
      return {
        hour: h,
        city_days: xs.length,
        dates: new Set(xs.map((r) => r.date)).size,
        forecast_vs_mid: pairedCI(xs),
        floor_vs_mid: floorMid,
        floor_vs_forecast: floorForecast,
        formal_testing_allowed: formal,
        verdict: !formal
          ? "GATED_BY_PRIMARY"
          : !enough
            ? "INSUFFICIENT_SAMPLE"
            : floorMid?.lower > 0 && floorForecast?.lower > 0
              ? "MEASUREMENT_EDGE"
              : "NO_DEMONSTRATED_EDGE",
      };
    }),
    tails_by_city: spec.cities.flatMap((c) =>
      ["low", "high"].map((tail) => {
        const key = tail + "_tail_delta";
        const xs = eligible
          .filter((r) => r.city === c.id && r.slot === "day_ahead" && r[key] != null)
          .map((r) => ({ ...r, delta: Number(r[key]) }));
        const enough =
          xs.length >= spec.secondary_min_city_days &&
          new Set(xs.map((r) => r.date)).size >= spec.secondary_min_dates;
        const ci = pairedCI(
          xs,
          spec.bootstrap_replicates,
          spec.bootstrap_seed,
          spec.secondary_family_alpha / spec.secondary_tail_tests,
        );
        return {
          city: c.id,
          tail,
          city_days: xs.length,
          dates: new Set(xs.map((r) => r.date)).size,
          ci,
          mean_market_mispricing: xs.length
            ? xs.reduce((s, r) => s + Number(r[tail + "_tail_mispricing"]), 0) / xs.length
            : null,
          formal_testing_allowed: formal,
          verdict: !formal
            ? "GATED_BY_PRIMARY"
            : !enough
              ? "INSUFFICIENT_SAMPLE"
              : ci?.lower > 0
                ? "MEASUREMENT_EDGE"
                : "NO_DEMONSTRATED_EDGE",
        };
      }),
    ),
    capture_quality: (
      await client.query(
        `select city,slot,count(*) as snapshots,count(*) filter(where quality->>'valid'='true') as valid,count(*) filter(where training_days>=$2) as trained from weather_research.snapshots where study=$1 group by city,slot order by city,slot`,
        [spec.id, spec.min_training_city_days],
      )
    ).rows,
    jobs: (
      await client.query(
        "select city,state,count(*) as jobs from weather_research.jobs where study=$1 group by city,state",
        [spec.id],
      )
    ).rows,
    limits:
      "Warmup is not a scored null test. City-day/date clustering; rungs are dependent. NWS observations are not the official settlement feed. No economic/trading claim. Secondary promotion never automatic.",
  };
}
