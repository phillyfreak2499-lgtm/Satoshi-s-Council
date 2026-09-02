/** US-session windows, stored in America/New_York wall time. DST is via the zone, never hardcoded UTC. */

export const ET = "America/New_York";

export type MarketTier = 0 | 1 | 2 | 3;
export type MarketId =
  | "fomc"
  | "macro"
  | "ny_am"
  | "lunch"
  | "close"
  | "london"
  | "tokyo"
  | "dead"
  | "weekend"
  | "open";

export type MarketRead = {
  id: MarketId;
  label: string;
  emoji: string;
  tier: MarketTier;
  event: string;
  until: number;
  next_id: MarketId;
  next_label: string;
  next_emoji: string;
  next_at: number;
  turn: boolean;
  micro: boolean;
};

type Slot = {
  id: MarketId;
  label: string;
  emoji: string;
  tier: MarketTier;
};

const FOMC = new Set([
  "2026-01-28",
  "2026-03-18",
  "2026-04-29",
  "2026-06-17",
  "2026-07-29",
  "2026-09-16",
  "2026-10-28",
  "2026-12-09",
  "2027-01-27",
  "2027-03-17",
  "2027-04-28",
  "2027-06-09",
  "2027-07-28",
  "2027-09-15",
  "2027-10-27",
  "2027-12-08",
]);

const CPI = new Set([
  "2026-01-13",
  "2026-02-13",
  "2026-03-11",
  "2026-04-10",
  "2026-05-12",
  "2026-06-10",
  "2026-07-14",
  "2026-08-12",
  "2026-09-11",
  "2026-10-14",
  "2026-11-10",
  "2026-12-10",
]);

const NFP = new Set([
  "2026-01-09",
  "2026-02-11",
  "2026-03-06",
  "2026-04-03",
  "2026-05-08",
  "2026-06-05",
  "2026-07-02",
  "2026-08-07",
  "2026-09-04",
  "2026-10-02",
  "2026-11-06",
  "2026-12-04",
]);

const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function etParts(ts: number) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const bag: Record<string, string> = {};
  for (const p of dtf.formatToParts(new Date(ts))) {
    if (p.type !== "literal") bag[p.type] = p.value;
  }
  const h = Number(bag.hour);
  const min = Number(bag.minute);
  const s = Number(bag.second);
  return {
    date: `${bag.year}-${bag.month}-${bag.day}`,
    wd: WD[bag.weekday ?? ""] ?? 0,
    mins: h * 60 + min + s / 60,
  };
}

function eventOf(date: string, wd: number): string {
  if (FOMC.has(date)) return "FOMC";
  if (CPI.has(date)) return "CPI";
  if (NFP.has(date)) return "NFP";
  if (wd === 4) return "CLAIMS";
  return "";
}

function slotAt(ts: number): Slot & { event: string } {
  const { date, wd, mins } = etParts(ts);
  const weekend = wd === 0 || wd === 6;
  const event = weekend ? "" : eventOf(date, wd);
  const dataAm = event === "CPI" || event === "NFP" || event === "CLAIMS";
  if (weekend) return { id: "weekend", label: "weekend", emoji: "💤", tier: 0, event: "" };
  if (event === "FOMC" && mins >= 13 * 60 + 55 && mins < 15 * 60 + 30) {
    return { id: "fomc", label: "FOMC hour", emoji: "🥇", tier: 1, event };
  }
  if (dataAm && mins >= 8 * 60 + 25 && mins < 9 * 60 + 30) {
    return { id: "macro", label: "macro ignition", emoji: "🥇", tier: 1, event };
  }
  if (mins >= 9 * 60 + 30 && mins < 12 * 60) {
    return { id: "ny_am", label: "NY morning", emoji: "🥇", tier: 1, event };
  }
  if (mins >= 15 * 60 + 45 && mins < 16 * 60 + 15) {
    return { id: "close", label: "equity close", emoji: "🥈", tier: 2, event };
  }
  if (mins >= 12 * 60 && mins < 14 * 60) {
    return { id: "lunch", label: "NY lunch", emoji: "🥈", tier: 2, event };
  }
  if (mins >= 2 * 60 + 50 && mins < 4 * 60) {
    return { id: "london", label: "London open", emoji: "🥉", tier: 3, event };
  }
  if (mins >= 20 * 60 && mins < 21 * 60) {
    return { id: "tokyo", label: "Tokyo open", emoji: "🥉", tier: 3, event };
  }
  if (mins >= 18 * 60 || mins < 2 * 60 + 50) {
    return { id: "dead", label: "late US / pre-London", emoji: "💤", tier: 0, event };
  }
  return { id: "open", label: "open tape", emoji: "·", tier: 3, event };
}

function nearTurn(ts: number, closeTime: number): boolean {
  const secsLeft = Math.max(0, (closeTime - ts) / 1000);
  if (secsLeft <= 60 || secsLeft >= 14 * 60) return true;
  const { mins } = etParts(ts);
  const m = mins % 15;
  return m < 1 || m > 14;
}

export function zoneTag(tz: string): string {
  if (/Chicago|Central/i.test(tz)) return "CT";
  if (/New_York|Detroit|Eastern/i.test(tz)) return "ET";
  if (/Los_Angeles|Pacific/i.test(tz)) return "PT";
  if (/Denver|Mountain/i.test(tz)) return "MT";
  try {
    const name = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" })
      .formatToParts(new Date())
      .find((p) => p.type === "timeZoneName")?.value;
    return name ?? "local";
  } catch {
    return "local";
  }
}

export function fmtLocal(ts: number, tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).formatToParts(new Date(ts));
    const hour = parts.find((p) => p.type === "hour")?.value ?? "";
    const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
    const day = (parts.find((p) => p.type === "dayPeriod")?.value ?? "").toLowerCase().startsWith("p")
      ? "p"
      : "a";
    const mm = minute === "00" ? "" : `:${minute}`;
    return `${hour}${mm}${day} ${zoneTag(tz)}`;
  } catch {
    return new Date(ts).toISOString().slice(11, 16);
  }
}

export function readMarket(ts: number, closeTime: number): MarketRead {
  const cur = slotAt(ts);
  let until = ts + 60_000;
  const cap = ts + 20 * 60 * 60 * 1000;
  for (let t = ts + 60_000; t < cap; t += 60_000) {
    if (slotAt(t).id !== cur.id) {
      until = t;
      break;
    }
  }
  const nxt = slotAt(until);
  const turn = nearTurn(ts, closeTime);
  const { mins } = etParts(ts);
  const ignitionMin = Math.abs(mins - (8 * 60 + 30)) < 1.1 && (cur.event === "CPI" || cur.event === "NFP" || cur.event === "CLAIMS");
  const micro = turn || ignitionMin;
  return {
    id: cur.id,
    label: cur.label,
    emoji: cur.emoji,
    tier: cur.tier,
    event: cur.event,
    until,
    next_id: nxt.id,
    next_label: nxt.label,
    next_emoji: nxt.emoji,
    next_at: until,
    turn,
    micro,
  };
}
