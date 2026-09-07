/**
 * The Pit Crew (server only): SWEEP scores the seats once a day, COACH
 * turns their knobs once a day on evidence from windows it did not tune
 * on, WRENCH's log is synced from the repo. See crew.ts for the rules.
 */
import {
  centsAt,
  coachDecide,
  DEFAULT_KNOBS,
  flagNote,
  NON_VOTERS,
  SWEEP_DAYS,
  sweepFlags,
  type MidRead,
  type SeatFlag,
  type SeatStats,
} from "./crew";
import { SPEAK_CONF } from "./math";
import { SEAT_IDS, type Learner, type SeatKnobs } from "./types";
import { WRENCH_LOG } from "./wrench-log";

type Crew = {
  synced: boolean;
  lastSweepDay: string;
  lastSweepLine: string;
  lastCoachDay: string;
  cache: { at: number; body: unknown } | null;
  lastError: string | null;
};

const g = globalThis as typeof globalThis & { __desk_crew__?: Crew };
function crew(): Crew {
  g.__desk_crew__ ??= { synced: false, lastSweepDay: "", lastSweepLine: "", lastCoachDay: "", cache: null, lastError: null };
  return g.__desk_crew__;
}

async function sql() {
  const { getSql } = await import("@/lib/db");
  return getSql();
}

/** Today's date in Chicago, the desk's day. */
export function chicagoDay(t = Date.now()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(t),
  );
}

const VOTERS = SEAT_IDS.filter((s) => !NON_VOTERS.includes(s));

type SeatCell = { lean?: string; conf?: number; hit?: boolean | null; raw_lean?: string; raw_conf?: number };

/** Mid-window reads per seat from the v2 sample table (7.5 minutes out). */
async function midReads(days: number): Promise<Map<string, MidRead[]>> {
  const db = await sql();
  const rows = await db<{ t: string; features: Record<string, number>; market: Record<string, unknown>; winner: "UP" | "DOWN" }>`
    select taken_at::text as t, features, market, winner
      from desk_samples
     where winner in ('UP','DOWN') and taken_at > now() - (${days} || ' days')::interval
     order by taken_at
  `;
  const out = new Map<string, MidRead[]>();
  for (const r of rows) {
    const t = Date.parse(r.t);
    const yesAsk = Number(r.market?.yes_ask);
    const noAsk = Number(r.market?.no_ask);
    for (const seat of VOTERS) {
      const ev = Number(r.features?.[seat] ?? 0);
      if (!(Math.abs(ev) > 0.001)) continue;
      const lean: "UP" | "DOWN" = ev > 0 ? "UP" : "DOWN";
      const ask = lean === "UP" ? yesAsk : noAsk;
      if (!(ask > 0) || !(ask < 100)) continue;
      let arr = out.get(seat);
      if (!arr) {
        arr = [];
        out.set(seat, arr);
      }
      arr.push({ t, conf: Math.round(Math.abs(ev) * 100), lean, ask, winner: r.winner });
    }
  }
  return out;
}

async function seatStats(learner: Learner, mid: Map<string, MidRead[]>, now: number): Promise<SeatStats[]> {
  const db = await sql();
  const rows = await db<{ seats: Record<string, SeatCell> }>`
    select seats from desk_ledger where close_time > now() - (${SWEEP_DAYS} || ' days')::interval
  `;
  const weekAgo = now - SWEEP_DAYS * 86_400_000;
  const stats: SeatStats[] = [];
  for (const seat of SEAT_IDS) {
    if (seat === "WARDEN") continue;
    let reads = 0;
    let spoke = 0;
    let spokeHits = 0;
    let maxConf: number | null = null;
    let confSum = 0;
    for (const row of rows) {
      const c = row.seats?.[seat];
      if (!c) continue;
      const rawDir = c.raw_lean === "UP" || c.raw_lean === "DOWN";
      const spk = c.lean === "UP" || c.lean === "DOWN";
      if (rawDir) {
        reads += 1;
        const rc = Number(c.raw_conf ?? 0);
        confSum += rc;
        maxConf = maxConf == null ? rc : Math.max(maxConf, rc);
      }
      if (spk) {
        spoke += 1;
        if (c.hit) spokeHits += 1;
      }
    }
    const m = (mid.get(seat) ?? []).filter((r) => r.t >= weekAgo);
    const mc = centsAt(m, 0);
    stats.push({
      seat,
      reads,
      spoke,
      gagged: Math.max(0, reads - spoke),
      max_conf: maxConf,
      avg_conf: reads ? Math.round(confSum / reads) : null,
      spoke_hit_pct: spoke ? Math.round((100 * spokeHits) / spoke) : null,
      mid_n: m.length,
      mid_hit_pct: m.length ? Math.round(mc.hit_pct) : null,
      mid_cents: m.length ? Math.round(mc.cents * 10) / 10 : null,
      grade_n: learner.seat_n?.[seat] ?? 0,
    });
  }
  return stats;
}

async function log(
  who: "SWEEP" | "COACH" | "WRENCH",
  seat: string | null,
  action: string,
  detail: string,
  extra: { before?: unknown; after?: unknown; evidence?: unknown; slug?: string } = {},
): Promise<void> {
  const db = await sql();
  await db`
    insert into desk_crew_log (who, seat, action, detail, before, after, evidence, slug)
    values (${who}, ${seat}, ${action}, ${detail},
            ${extra.before == null ? null : JSON.stringify(extra.before)}::jsonb,
            ${extra.after == null ? null : JSON.stringify(extra.after)}::jsonb,
            ${extra.evidence == null ? null : JSON.stringify(extra.evidence)}::jsonb,
            ${extra.slug ?? null})
    on conflict (slug) do nothing
  `;
}

/** SWEEP: score every seat over the last week, flag, store, and return one
 *  short line for the desk recap. Idempotent per Chicago day. */
export async function sweepRun(learner: Learner, now = Date.now()): Promise<string> {
  const C = crew();
  const day = chicagoDay(now);
  // The recap check runs every few minutes all day; the scorecard is daily.
  if (C.lastSweepDay === day) return C.lastSweepLine;
  try {
    const db = await sql();
    const mid = await midReads(SWEEP_DAYS);
    const stats = await seatStats(learner, mid, now);
    const prev = await db<{ seat: string; flags: string[] }>`
      select seat, flags from desk_crew_reports where day = (select max(day) from desk_crew_reports where day < ${day}::date)
    `;
    const prevFlags = new Map(prev.map((r) => [r.seat, r.flags ?? []]));
    const flagged: string[] = [];
    for (const s of stats) {
      const bar = SPEAK_CONF + (learner.knobs?.[s.seat]?.speak_offset ?? 0);
      const flags = sweepFlags(s, bar);
      const note = flags.map((f) => `${f}: ${flagNote(f, s, bar)}`).join(" · ") || null;
      await db`
        insert into desk_crew_reports
          (day, seat, reads, spoke, gagged, max_conf, avg_conf, spoke_hit_pct, mid_n, mid_hit_pct, mid_cents, grade_n, flags, note)
        values
          (${day}::date, ${s.seat}, ${s.reads}, ${s.spoke}, ${s.gagged}, ${s.max_conf}, ${s.avg_conf}, ${s.spoke_hit_pct},
           ${s.mid_n}, ${s.mid_hit_pct}, ${s.mid_cents}, ${s.grade_n}, ${flags}::text[], ${note})
        on conflict (day, seat) do update set
          reads = excluded.reads, spoke = excluded.spoke, gagged = excluded.gagged, max_conf = excluded.max_conf,
          avg_conf = excluded.avg_conf, spoke_hit_pct = excluded.spoke_hit_pct, mid_n = excluded.mid_n,
          mid_hit_pct = excluded.mid_hit_pct, mid_cents = excluded.mid_cents, grade_n = excluded.grade_n,
          flags = excluded.flags, note = excluded.note
      `;
      const was = prevFlags.get(s.seat) ?? [];
      for (const f of flags) {
        if (!was.includes(f)) {
          await log("SWEEP", s.seat, "flag", `${s.seat} ${f} — ${flagNote(f as SeatFlag, s, bar)}`, {
            evidence: s,
            slug: `sweep-${day}-${s.seat}-${f}`,
          });
        }
      }
      for (const f of was) {
        if (!flags.includes(f as SeatFlag)) {
          await log("SWEEP", s.seat, "clear", `${s.seat} no longer ${f}`, { evidence: s, slug: `sweep-${day}-${s.seat}-clear-${f}` });
        }
      }
      if (flags.length) flagged.push(`${s.seat} ${flags.map((f) => f.toLowerCase()).join("+")}`);
    }
    C.lastSweepDay = day;
    C.lastSweepLine = flagged.length ? `SWEEP flags: ${flagged.join(", ")}` : "SWEEP: no flags";
    C.cache = null;
    return C.lastSweepLine;
  } catch (err) {
    C.lastError = `sweep: ${err instanceof Error ? err.message : String(err)}`;
    return "";
  }
}

/** COACH: one decision per voting seat per Chicago day, applied to the
 *  live learner's knobs (the only writer) and logged with its evidence. */
export async function coachRun(learner: Learner, now = Date.now()): Promise<string[]> {
  const C = crew();
  const day = chicagoDay(now);
  const lines: string[] = [];
  if (C.lastCoachDay === day) return lines;
  try {
    const db = await sql();
    const done = await db<{ n: number }>`select count(*)::int as n from desk_crew_log where slug = ${`coach-${day}`}`;
    if (done[0]?.n) {
      C.lastCoachDay = day;
      return lines;
    }
    const mid = await midReads(28);
    learner.knobs ??= {};
    for (const seat of VOTERS) {
      const before: SeatKnobs = { ...DEFAULT_KNOBS, ...(learner.knobs[seat] ?? {}) };
      const d = coachDecide(mid.get(seat) ?? [], before, now);
      if (d.action === "hold") continue;
      learner.knobs[seat] = d.knobs;
      await log("COACH", seat, d.action, `${seat}: ${d.knobs.reason}`, { before, after: d.knobs, evidence: d.evidence });
      lines.push(`${seat} ${d.action}: ${d.knobs.reason}`);
    }
    await log("COACH", null, "run", lines.length ? `${lines.length} change${lines.length === 1 ? "" : "s"}` : "no changes — every seat held", {
      slug: `coach-${day}`,
    });
    C.lastCoachDay = day;
    C.cache = null;
  } catch (err) {
    C.lastError = `coach: ${err instanceof Error ? err.message : String(err)}`;
  }
  return lines;
}

/** WRENCH's checked-in log → the table, once per boot. */
export async function syncWrenchLog(): Promise<void> {
  const C = crew();
  if (C.synced) return;
  C.synced = true;
  for (const e of WRENCH_LOG) {
    await log("WRENCH", null, "pr", `${e.title}${e.pr ? ` (#${e.pr})` : ""}: ${e.summary}`, {
      slug: `wrench-${e.slug}`,
      evidence: { date: e.date, pr: e.pr },
    }).catch(() => {});
  }
}

/** Boot: sync WRENCH's log; run SWEEP if today's scorecard is missing. */
export async function ensureCrewBoot(learner: Learner): Promise<void> {
  const C = crew();
  try {
    await syncWrenchLog();
    const db = await sql();
    const day = chicagoDay();
    const have = await db<{ n: number }>`select count(*)::int as n from desk_crew_reports where day = ${day}::date`;
    if (!have[0]?.n) await sweepRun(learner);
  } catch (err) {
    C.lastError = `boot: ${err instanceof Error ? err.message : String(err)}`;
  }
}

/** The panel. Cached 30s; the tab polls once a minute while open. */
export async function crewSummary(): Promise<unknown> {
  const C = crew();
  if (C.cache && Date.now() - C.cache.at < 30_000) return C.cache.body;
  const db = await sql();
  const [latest] = await db<{ day: string | null }>`select max(day)::text as day from desk_crew_reports`;
  const reports = latest?.day
    ? await db`select seat, reads, spoke, gagged, max_conf, avg_conf, spoke_hit_pct, mid_n, mid_hit_pct, mid_cents, grade_n, flags, note
                 from desk_crew_reports where day = ${latest.day}::date order by mid_n desc, reads desc`
    : [];
  const logRows = await db`select t::text as t, who, seat, action, detail, evidence from desk_crew_log order by t desc limit 60`;
  const { getLearnerKnobs } = await import("./server-engine");
  const knobs = getLearnerKnobs();
  const body = {
    day: latest?.day ?? null,
    bar: SPEAK_CONF,
    reports,
    knobs,
    log: logRows,
    last_sweep_day: C.lastSweepDay,
    last_coach_day: C.lastCoachDay,
    last_error: C.lastError,
  };
  C.cache = { at: Date.now(), body };
  return body;
}
