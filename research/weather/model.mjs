/** Pure research math. No imports from the application, no trade objects. */
export const finite = (x) => typeof x === "number" && Number.isFinite(x);
export const fFromC = (c) => (finite(c) ? (c * 9) / 5 + 32 : null);
export function dayWindow(date, offset) {
  const start = Date.parse(date + "T00:00:00Z") - offset * 3600000;
  if (!Number.isFinite(start)) throw Error("invalid target date");
  return { start, end: start + 86400000 };
}
export function localClock(now, zone) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), minute: Number(p.minute) };
}
export const addDay = (date) =>
  new Date(Date.parse(date + "T12:00:00Z") + 86400000).toISOString().slice(0, 10);
export function eventDate(ticker, series) {
  const m = ticker.match(new RegExp("^" + series + "-(\\d{2})([A-Z]{3})(\\d{2})$"));
  const months = [
    "JAN",
    "FEB",
    "MAR",
    "APR",
    "MAY",
    "JUN",
    "JUL",
    "AUG",
    "SEP",
    "OCT",
    "NOV",
    "DEC",
  ];
  if (!m || !months.includes(m[2])) return null;
  const date = `20${m[1]}-${String(months.indexOf(m[2]) + 1).padStart(2, "0")}-${m[3]}`;
  return new Date(date + "T12:00:00Z").toISOString().slice(0, 10) === date ? date : null;
}
export function forecastHigh(periods, start, end, now = null, observedFloor = null) {
  if (now != null && now >= start) {
    if (!finite(observedFloor)) return null;
    start = Math.ceil(now / 3600000) * 3600000;
  }
  const selected = periods
    .filter((p) => Date.parse(p.startTime) >= start && Date.parse(p.endTime) <= end)
    .sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime));
  if (
    !selected.length ||
    selected.length !== (end - start) / 3600000 ||
    Date.parse(selected[0].startTime) !== start ||
    Date.parse(selected.at(-1).endTime) !== end
  )
    return null;
  const temperatures = [];
  for (let i = 0; i < selected.length; i++) {
    const p = selected[i];
    if (
      !finite(p.temperature) ||
      Date.parse(p.endTime) - Date.parse(p.startTime) !== 3600000 ||
      (i > 0 && Date.parse(p.startTime) !== Date.parse(selected[i - 1].endTime))
    )
      return null;
    const t =
      p.temperatureUnit === "F"
        ? p.temperature
        : p.temperatureUnit === "C"
          ? fFromC(p.temperature)
          : null;
    if (!finite(t)) return null;
    temperatures.push(t);
  }
  return Math.max(...temperatures, observedFloor ?? -Infinity);
}
/** Integer daily maximum and exact market inequalities; not strike-midpoint guessing. */
export function bracketContains(m, high) {
  if (!finite(high)) return null;
  if (m.strike_type === "between" && finite(m.floor_strike) && finite(m.cap_strike))
    return high >= m.floor_strike && high <= m.cap_strike;
  if (m.strike_type === "greater" && finite(m.floor_strike)) return high > m.floor_strike;
  if (m.strike_type === "less" && finite(m.cap_strike)) return high < m.cap_strike;
  return null;
}
export function price(m, side) {
  const dollars = m[side + "_dollars"];
  const legacy = m[side];
  if (dollars != null && dollars !== "") {
    const v = Number(dollars) * 100;
    return Number.isFinite(v) && v >= 0 && v <= 100 ? v : null;
  }
  return finite(legacy) && legacy >= 0 && legacy <= 100 ? legacy : null;
}
export function marketMid(m, maxSpread) {
  const bid = price(m, "yes_bid"),
    ask = price(m, "yes_ask");
  return bid != null && ask != null && bid <= ask && ask > 0 && bid < 100 && ask - bid <= maxSpread
    ? (bid + ask) / 200
    : null;
}
/** All rungs must form an exhaustive disjoint partition over integer highs. */
export function completeBrackets(markets) {
  if (!markets.length) return false;
  if (markets.some((m) => m.strike_type === "between" && m.floor_strike > m.cap_strike))
    return false;
  const bounds = markets.flatMap((m) => [m.floor_strike, m.cap_strike]).filter(finite);
  if (!bounds.length || bounds.some((x) => !Number.isInteger(x))) return false;
  for (let high = Math.min(...bounds) - 1; high <= Math.max(...bounds) + 1; high++) {
    if (markets.reduce((n, m) => n + Number(bracketContains(m, high) === true), 0) !== 1)
      return false;
  }
  return true;
}
export function observationSummary(features, start, now) {
  const temps = features.flatMap((f) => {
    const p = f.properties ?? {};
    const ts = Date.parse(p.timestamp);
    const t = p.temperature;
    const quality = t?.qualityControl;
    if (!(ts >= start && ts <= now) || quality !== "V" || !finite(t?.value)) return [];
    const value =
      t.unitCode === "wmoUnit:degC"
        ? fFromC(t.value)
        : t.unitCode === "wmoUnit:degF"
          ? t.value
          : null;
    return finite(value) ? [{ value, ts }] : [];
  });
  return {
    floor: temps.length ? Math.max(...temps.map((t) => t.value)) : null,
    latest: temps.length ? Math.max(...temps.map((t) => t.ts)) : null,
  };
}
export function observationFloor(features, start, now) {
  return observationSummary(features, start, now).floor;
}
/** Walk-forward empirical error distribution; no future labels, no pooled cities. */
export function bracketProbabilities(markets, forecast, residuals, minN, observedFloor = null) {
  if (
    !finite(forecast) ||
    residuals.length < minN ||
    residuals.some((x) => !finite(x)) ||
    !completeBrackets(markets)
  )
    return null;
  const highs = residuals.map((e) =>
    Math.round(Math.max(forecast + e, observedFloor ?? -Infinity)),
  );
  return markets.map((m) => ({
    ticker: m.ticker,
    p: highs.filter((h) => bracketContains(m, h)).length / highs.length,
  }));
}
export const brier = (p, y) => (p - y) ** 2;
/** Paired daily units; cities and brackets on a shared date are clustered together. */
export function pairedCI(rows, replicates = 2000, seed = 387385, alpha = 0.05) {
  const dates = new Map();
  for (const r of rows) {
    const xs = dates.get(r.date) ?? [];
    xs.push(r.delta);
    dates.set(r.date, xs);
  }
  const values = [...dates.values()].map((xs) => xs.reduce((s, x) => s + x, 0) / xs.length);
  if (values.length < 2) return null;
  let state = seed >>> 0;
  const rnd = () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const boot = Array.from(
    { length: replicates },
    () => values.reduce((s) => s + values[Math.floor(rnd() * values.length)], 0) / values.length,
  ).sort((a, b) => a - b);
  return {
    dates: values.length,
    mean: values.reduce((s, v) => s + v, 0) / values.length,
    lower: boot[Math.floor((replicates * alpha) / 2)],
    upper: boot[Math.floor(replicates * (1 - alpha / 2))],
  };
}
