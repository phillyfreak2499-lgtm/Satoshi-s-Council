/**
 * LEDGER (server only): once a Chicago day it reads the ledger's per-window
 * vote matrix, mines cross-seat pair and coalition patterns, and promotes the
 * ones that hold on the windows after the range they were found on. The
 * promoted cards are cached in memory so the chair can cite the ones that fire
 * on the live window — a labelled, non-binding line, never a gate. See
 * ledger-clerk.ts for the rules. LEDGER never votes.
 */
import { chairDecisionOf } from "./booked-side";
import { chicagoDay } from "./crew.server";
import {
  citedWilson,
  firingCitations,
  type LedgerWindow,
  mine,
  type MinedPattern,
  type PatternStatus,
  type Side,
  stancesFromVotes,
} from "./ledger-clerk";
import type { LedgerCite, Lean, Vote } from "./types";

async function sql() {
  const { getSql } = await import("@/lib/db");
  return getSql();
}

type LedgerMeta = {
  windows: number;
  train_n: number;
  test_n: number;
  split_at: number | null;
  found_from: number | null;
  found_to: number | null;
  test_to: number | null;
  considered: number;
};

type State = {
  lastRunDay: string;
  lastLine: string;
  cited: LedgerCite[];
  citedAt: number;
  citedInflight: Promise<void> | null;
  meta: LedgerMeta | null;
  cache: { at: number; body: unknown } | null;
  lastError: string | null;
};

const g = globalThis as typeof globalThis & { __desk_ledger_clerk__?: State };
function state(): State {
  g.__desk_ledger_clerk__ ??= {
    lastRunDay: "",
    lastLine: "",
    cited: [],
    citedAt: 0,
    citedInflight: null,
    meta: null,
    cache: null,
    lastError: null,
  };
  return g.__desk_ledger_clerk__;
}

/** The ledger's per-window vote matrix, most-recent windows first then sorted
 *  ascending for the walk-forward split. Capped so an all-time desk stays
 *  bounded; the split naturally holds out the freshest windows. */
async function loadWindows(): Promise<LedgerWindow[]> {
  const db = await sql();
  const rows = await db<{
    close_time: Date | string;
    winner: string;
    chair_lean: string | null;
    entry_cents: number | null;
    settle_cents: number | null;
    ev_cents: number | null;
    seats: Record<string, { lean?: string; raw_lean?: string }> | null;
  }>`
    select close_time, winner, chair_lean, entry_cents, settle_cents, ev_cents, seats
      from (
        select close_time, winner, chair_lean, entry_cents, settle_cents, ev_cents, seats
          from desk_ledger
         where winner in ('UP','DOWN')
         order by close_time desc
         limit 1500
      ) q
     order by close_time asc
  `;
  const out: LedgerWindow[] = [];
  for (const r of rows) {
    const stance: Record<string, Side> = {};
    for (const [seat, cell] of Object.entries(r.seats ?? {})) {
      if (!cell || typeof cell !== "object") continue;
      const honest = cell.raw_lean === "UP" || cell.raw_lean === "DOWN" ? cell.raw_lean : cell.lean;
      if (honest === "UP" || honest === "DOWN") stance[seat] = honest;
    }
    // The side the chair actually booked — LedgerWindow.chair_lean is documented
    // as the booked side, and reading the decayed column made the book
    // attribution on every pattern card read as if the chair had sat.
    const chair: Lean = chairDecisionOf(r.chair_lean, r.settle_cents, r.winner === "UP" ? "UP" : r.winner === "DOWN" ? "DOWN" : null);
    out.push({
      t: r.close_time instanceof Date ? r.close_time.getTime() : Date.parse(String(r.close_time)),
      winner: r.winner === "UP" ? "UP" : "DOWN",
      chair_lean: chair,
      ev_cents: r.ev_cents == null ? null : Number(r.ev_cents),
      stance,
    });
  }
  return out;
}

function isoOrNull(ms: number | null): string | null {
  return ms == null ? null : new Date(ms).toISOString();
}

/** LEDGER's daily mine. Idempotent per Chicago day; returns one short digest
 *  line, or "" when it had nothing to say. */
export async function ledgerRun(now = Date.now()): Promise<string> {
  const L = state();
  const day = chicagoDay(now);
  if (L.lastRunDay === day) return L.lastLine;
  try {
    const windows = await loadWindows();
    const res = mine(windows, now);
    L.meta = {
      windows: res.windows,
      train_n: res.train_n,
      test_n: res.test_n,
      split_at: res.split_at,
      found_from: res.found_from,
      found_to: res.found_to,
      test_to: res.test_to,
      considered: res.considered,
    };
    if (res.skipped) {
      L.lastRunDay = day;
      L.lastLine = "";
      L.cache = null;
      await refreshCited();
      return "";
    }

    const db = await sql();
    const runAt = new Date(now).toISOString();
    for (const p of res.patterns) {
      await db`
        insert into desk_ledger_patterns
          (slug, kind, members, agree_side, cited_side, status, train_n, train_hits, train_wilson,
           test_n, test_hits, test_wilson, member_solo, net_cents, booked_n, split_at, found_from, found_to, test_to, updated_at, note)
        values
          (${p.slug}, ${p.kind}, ${p.members}::text[], ${p.agree_side}, ${p.cited_side}, ${p.status},
           ${p.train_n}, ${p.train_hits}, ${p.train_wilson}, ${p.test_n}, ${p.test_hits}, ${p.test_wilson},
           ${p.member_solo}, ${p.net_cents}, ${p.booked_n}, ${isoOrNull(res.split_at)}::timestamptz,
           ${isoOrNull(res.found_from)}::timestamptz, ${isoOrNull(res.found_to)}::timestamptz,
           ${isoOrNull(res.test_to)}::timestamptz, ${runAt}::timestamptz, ${p.note})
        on conflict (slug) do update set
          kind = excluded.kind, members = excluded.members, agree_side = excluded.agree_side,
          cited_side = excluded.cited_side, status = excluded.status, train_n = excluded.train_n,
          train_hits = excluded.train_hits, train_wilson = excluded.train_wilson, test_n = excluded.test_n,
          test_hits = excluded.test_hits, test_wilson = excluded.test_wilson, member_solo = excluded.member_solo,
          net_cents = excluded.net_cents, booked_n = excluded.booked_n, split_at = excluded.split_at,
          found_from = excluded.found_from, found_to = excluded.found_to, test_to = excluded.test_to,
          updated_at = excluded.updated_at, note = excluded.note
      `;
    }
    // A card LEDGER used to cite but did not re-find this run goes stale, not
    // deleted (the record stands). Candidates that lapsed are cleared.
    await db`update desk_ledger_patterns set status = 'stale', updated_at = ${runAt}::timestamptz
               where status in ('cited','inverted') and updated_at < ${runAt}::timestamptz`;
    await db`delete from desk_ledger_patterns where status = 'candidate' and updated_at < ${runAt}::timestamptz`;

    await refreshCited(true);
    const cited = res.patterns.filter((p) => p.status === "cited").length;
    const inverted = res.patterns.filter((p) => p.status === "inverted").length;
    L.lastLine =
      cited || inverted
        ? `LEDGER: ${citeCount(cited, inverted)}, held on the ${res.test_n} windows after the ${res.train_n} they were found on`
        : `LEDGER: no vote pattern clears the ${res.train_n}/${res.test_n} walk-forward test yet`;
    L.lastRunDay = day;
    L.cache = null;
    return L.lastLine;
  } catch (err) {
    L.lastError = `ledger: ${err instanceof Error ? err.message : String(err)}`;
    return "";
  }
}

function citeCount(cited: number, inverted: number): string {
  const parts: string[] = [];
  if (cited) parts.push(`${cited} pattern${cited === 1 ? "" : "s"} cited`);
  if (inverted) parts.push(`${inverted} inverted`);
  return parts.join(", ");
}

type PromotedRow = { members: string[]; agree_side: string; cited_side: string; status: string; test_n: number; test_hits: number; test_wilson: number };

/** Refresh the in-memory cited/inverted cache the chair reads. Never throws. */
async function refreshCited(force = false): Promise<void> {
  const L = state();
  if (!force && L.citedInflight) return L.citedInflight;
  const job = (async () => {
    try {
      const db = await sql();
      const rows = await db<PromotedRow>`
        select members, agree_side, cited_side, status, test_n, test_hits, test_wilson
          from desk_ledger_patterns
         where status in ('cited','inverted')
         order by test_wilson desc
         limit 40
      `;
      L.cited = rows.map((r) => {
        const status: "cited" | "inverted" = r.status === "inverted" ? "inverted" : "cited";
        return {
          members: r.members ?? [],
          agree_side: r.agree_side === "DOWN" ? "DOWN" : "UP",
          cited_side: r.cited_side === "DOWN" ? "DOWN" : "UP",
          status,
          wilson: citedWilson({ status, test_n: r.test_n, test_hits: r.test_hits, test_wilson: Number(r.test_wilson) }),
          n: r.test_n,
        } satisfies LedgerCite;
      });
      L.citedAt = Date.now();
    } catch (err) {
      L.lastError = `ledger cited: ${err instanceof Error ? err.message : String(err)}`;
    }
  })();
  L.citedInflight = job.finally(() => {
    if (state().citedInflight === job) state().citedInflight = null;
  });
  return force ? job : L.citedInflight;
}

const CITED_TTL_MS = 6 * 60_000;

/** The promoted cards, synchronously, for the chair's per-tick read. Kicks off
 *  a background refresh when stale; returns whatever is cached now (possibly
 *  empty on a cold boot — citations are additive, so that is safe). */
export function citedPatternsSync(): LedgerCite[] {
  const L = state();
  if (Date.now() - L.citedAt > CITED_TTL_MS) void refreshCited();
  return L.cited;
}

/** The labelled, non-binding patterns that fire on the current votes. */
export function ledgerCitesFor(votes: readonly Vote[]): LedgerCite[] {
  return firingCitations(stancesFromVotes(votes), citedPatternsSync());
}

/** Boot: warm the cited cache and run today's mine if it has not happened. */
export async function ensureLedgerBoot(): Promise<void> {
  const L = state();
  try {
    await refreshCited(true);
    if (L.lastRunDay !== chicagoDay()) await ledgerRun();
  } catch (err) {
    L.lastError = `ledger boot: ${err instanceof Error ? err.message : String(err)}`;
  }
}

type SummaryRow = MinedPattern & { updated_at: string };

/** The read-only pane. Cached 30s; the tab polls once a minute while open. */
export async function ledgerSummary(): Promise<unknown> {
  const L = state();
  if (L.cache && Date.now() - L.cache.at < 30_000) return L.cache.body;
  const db = await sql();
  const rows = await db<{
    slug: string;
    kind: string;
    members: string[];
    agree_side: string;
    cited_side: string;
    status: string;
    train_n: number;
    train_hits: number;
    train_wilson: number;
    test_n: number;
    test_hits: number;
    test_wilson: number;
    member_solo: number;
    net_cents: number;
    booked_n: number;
    updated_at: Date | string;
    note: string | null;
  }>`
    select slug, kind, members, agree_side, cited_side, status, train_n, train_hits, train_wilson,
           test_n, test_hits, test_wilson, member_solo, net_cents, booked_n, updated_at, note
      from desk_ledger_patterns
     order by
       case status when 'cited' then 0 when 'inverted' then 1 when 'candidate' then 2 else 3 end,
       test_wilson desc, train_wilson desc
     limit 60
  `;
  const patterns: SummaryRow[] = rows.map((r) => ({
    slug: r.slug,
    kind: r.kind === "coalition" ? "coalition" : "pair",
    members: r.members ?? [],
    agree_side: r.agree_side === "DOWN" ? "DOWN" : "UP",
    cited_side: r.cited_side === "DOWN" ? "DOWN" : "UP",
    status: (["cited", "inverted", "candidate", "stale"].includes(r.status) ? r.status : "candidate") as PatternStatus,
    train_n: r.train_n,
    train_hits: r.train_hits,
    train_wilson: Number(r.train_wilson),
    test_n: r.test_n,
    test_hits: r.test_hits,
    test_wilson: Number(r.test_wilson),
    member_solo: Number(r.member_solo),
    net_cents: Number(r.net_cents),
    booked_n: r.booked_n,
    note: r.note ?? "",
    updated_at: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at),
  }));
  // The cited-side Wilson is what a card actually points at (inverted flips it).
  const cited_wilson = (p: SummaryRow) => citedWilson(p);
  const body = {
    meta: L.meta,
    counts: {
      cited: patterns.filter((p) => p.status === "cited").length,
      inverted: patterns.filter((p) => p.status === "inverted").length,
      candidate: patterns.filter((p) => p.status === "candidate").length,
    },
    patterns: patterns.map((p) => ({ ...p, cited_wilson: Math.round(cited_wilson(p) * 1000) / 1000 })),
    last_run_day: L.lastRunDay || null,
    last_error: L.lastError,
  };
  L.cache = { at: Date.now(), body };
  return body;
}
