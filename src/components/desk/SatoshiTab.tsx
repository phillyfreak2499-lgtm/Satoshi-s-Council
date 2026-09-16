import { useEffect, useState, type ReactNode } from "react";
import { type CallLogRow, type ChairResult, type Lean, type SeatId, type SeatRow, type Settings, type Snapshot } from "@/lib/desk/types";
import { cn } from "@/lib/utils";
import { Field, LeanChip, MarketChip, MinsLeft, Mono, Pane, StatusChip } from "./bits";
import { V2_GATE_CALLS, V2_GATE_SAMPLES, V2_MIN_SAMPLES, v2Gates } from "@/lib/desk/chair-v2";
import type { V2Frame } from "@/lib/desk/server-engine";
import { ChairEyes } from "./Eyes";
import { Chamber } from "./Chamber";
import { ArenaPanel } from "./ArenaPanel";
import { Tip } from "./Tip";
import { readMarket } from "@/lib/desk/market-hours";
import { FULL_N } from "@/lib/desk/math";
import { markSide, readScalp, scalpAvg } from "@/lib/desk/scalp";
import { useDesk } from "@/lib/desk/store";
import { fetchBrief, type Brief, type GavelRow } from "@/lib/desk/brief";
import { GAVEL_SIZES, evCentsAt, fmtCentsAt, isGavelSize, type GavelSize } from "@/lib/desk/size-view";
import { bookState, bookableShadow, CHAIR_MIN_ASK_CENTS, FLOOR_SHADOW_CENTS } from "@/lib/desk/book-floor";
import { plainLine } from "@/lib/desk/chair-words";
import { CallPrices, CompactRecord, EvidenceBlock, LastReplayCard, WhyBlock } from "./FloorClarity";
import { fmtContracts, invalidateCondition, recordCard, whyFacts } from "@/lib/desk/floor-clarity";
import { FLOOR_LIVE_SINCE, openRow } from "@/lib/desk/book-floor";
import { economicsOf, type Economics } from "@/lib/desk/economics";
import type { FloorDensity } from "./prefs";
import { CouncilFloorRoom } from "./CouncilFloorRoom";
import { ChairSignalGauge } from "./ChairSignalGauge";
import { chairSignalOf, signalDescription } from "@/lib/desk/chair-signal";

/**
 * The ask for a side, from the one function the book marks with. This used to be
 * a local copy that differed from it in the WAIT case; a page about honesty does
 * not get to keep a second answer for the price.
 */
function sideAsk(snap: Snapshot, lean: Lean) {
  if (lean !== "UP" && lean !== "DOWN") return snap.yes_mid;
  return markSide(snap, lean);
}

function fmtClock(t: number, tz: string) {
  try {
    return new Date(t).toLocaleTimeString("en-US", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  } catch {
    return new Date(t).toISOString().slice(11, 19);
  }
}

/** A failing hard gate as a short, honest chip. Only gates that exist in live state reach here. */
const GATE_CHIP: Record<string, string> = {
  warden: "FEED",
  semantic: "BAD PRINT",
  seq: "SEQ GAP",
  derivs: "DERIVS",
  law: "LOCK",
  chalk: "CHALK",
  leftover: "NO EDGE",
  early: "EARLY",
  late: "LATE",
  spread: "WIDE SPREAD",
  quiet: "QUIET",
  top3: "SPLIT",
  bar: "SIGNAL LOW",
  edge: "THIN EDGE",
};

/** A pit-crew tag as a chip. FEED_DOWN / DERIVS_DOWN / LOCKDOWN reflect a real hard block, so they read as danger; the rest are context. */
function PitChip({ tag }: { tag: string }) {
  const blocking = tag === "FEED_DOWN" || tag === "DERIVS_DOWN" || tag === "LOCKDOWN";
  const warn = tag === "FEED_STALE" || tag === "BASIS_WIDE";
  const label = tag.replace(/_/g, " ").toLowerCase();
  return (
    <span
      className={cn(
        "rounded-sm border px-1.5 py-px font-mono text-micro uppercase tracking-wide",
        blocking ? "border-down/50 bg-down/10 text-down" : warn ? "border-wait/40 bg-wait/10 text-wait" : "border-border text-subtle",
      )}
    >
      {label}
    </span>
  );
}

/**
 * The economics of the call: every number the book weighs before it pays, in one
 * row. Display only — the values come from `economicsOf`, which carries them off
 * the frame the engine already decided on rather than working any of them out
 * again. The cells that can stop a fill are the ones that get colour.
 */
function EconomicsBox({ eco }: { eco: Economics }) {
  const cell = (label: string, value: string, tone?: string) => (
    <div key={label} className="min-w-0">
      <div className="font-mono text-micro uppercase tracking-wider text-subtle">{label}</div>
      <div className={cn("font-mono tabular text-ui", tone ?? "text-fg")}>{value}</div>
    </div>
  );
  const c = (n: number) => `${n.toFixed(1)}¢`;
  const signed = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}¢`;
  return (
    <div className="mt-3 rounded-md border border-border bg-bg/40 px-3 py-2.5">
      <div className="font-mono text-micro uppercase tracking-widest text-subtle">
        <Tip k="chair.economics">what this call costs</Tip>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-x-4 gap-y-2.5 sm:grid-cols-4 lg:grid-cols-8">
        {cell("side", eco.side ? (eco.side === "UP" ? "YES" : "NO") : "—", eco.side ? undefined : "text-wait")}
        {cell("fair", c(eco.fair))}
        {cell("ask", eco.side ? c(eco.ask) : "—", eco.side && !eco.bookable ? "text-wait" : undefined)}
        {cell("fee", eco.side ? c(eco.fee) : "—")}
        {cell("edge", eco.side ? signed(eco.edge) : "—", !eco.side ? undefined : eco.edge >= 0 ? "text-up" : "text-down")}
        {cell("needs", eco.side ? `${eco.breakeven.toFixed(0)}%` : "—")}
        {cell("leftover", signed(eco.leftover), eco.leftover < 0 ? "text-wait" : undefined)}
        {/* Contracts, from Kalshi's fractional-precision book, so the raw value is
            146.24058733173328. Whole contracts here, exactly as the research record
            and the quote fingerprint already round it; the VALUE is untouched and the
            touch <= 0 test below still reads the exact number. */}
        {cell("touch", eco.side ? fmtContracts(eco.touch) : "—", eco.side && eco.touch <= 0 ? "text-wait" : undefined)}
      </div>
      <div className="mt-2 font-mono text-micro text-muted">
        floor {eco.floor}¢ ·{" "}
        {eco.why ? (
          <span className="text-wait">{eco.why}</span>
        ) : (
          <span className="text-up">the book pays this</span>
        )}
      </div>
    </div>
  );
}

function ChairBoard({ snap, chair, tz, callLog, density }: { snap: Snapshot; chair: ChairResult; tz: string; callLog: CallLogRow[]; density: FloorDensity }) {
  const [mathOpen, setMathOpen] = useState(false);
  const lean = chair.lean;
  const signal = chairSignalOf(chair);
  const ask = sideAsk(snap, lean);
  const side = lean === "UP" ? "YES" : "NO";
  const book = bookState(snap, lean, callLog);
  const bookSide = book.kind === "booked" ? (book.lean === "UP" ? "YES" : "NO") : side;
  const tone = lean === "UP" ? "text-up" : lean === "DOWN" ? "text-down" : "text-wait";
  const edge = lean === "UP" ? snap.edge_up : lean === "DOWN" ? snap.edge_down : 0;
  const market = readMarket(snap.as_of, snap.close_time);
  const gap = signal?.margin ?? null;
  const gapClear = signal?.met ?? false;
  const failedGates = chair.gates.filter((g) => g.hard && !g.pass);
  const filled = book.kind === "booked";
  return (
    <section
      id="chair-stage"
      tabIndex={-1}
      data-tour="tour-satoshi"
      className={cn(
        "council-chair-board stage-anchor rounded-md border bg-surface p-4 outline-none sm:p-6",
        lean === "UP" ? "border-up/40 shadow-[0_0_0_1px_rgba(61,207,138,0.12)]" : lean === "DOWN" ? "border-down/40 shadow-[0_0_0_1px_rgba(239,107,115,0.12)]" : "border-border",
      )}
    >
      <div className="council-chair-summary">
        <div className="min-w-0">
          <div className="font-mono text-micro uppercase tracking-widest text-subtle">
            <Tip k="pane.board">Chair call</Tip>
          </div>
          <h1 className={cn("council-chair-verdict font-sans font-medium leading-none tracking-tight", tone)} aria-live="polite" aria-atomic="true">
            <span className="sr-only">Chair call: </span>
            {lean === "WAIT" ? "WAIT" : `${lean} ${ask.toFixed(0)}¢`}
          </h1>
          <p className="mt-1.5 max-w-[52ch] font-sans text-ui leading-snug text-fg" data-plain-line>
            {plainLine(chair, snap, book)}
          </p>
          <p className="mt-1 max-w-[52ch] font-sans text-ui leading-snug text-muted">
            {book.kind === "booked"
              ? `Paper only: booked ${book.lean} at ${book.cents.toFixed(0)}¢ on the ${bookSide} ask, held to settlement and graded on Kalshi's official value.${
                  lean !== book.lean ? " The read has moved since; one position per window means the book does not sell low to buy high." : ""
                }`
              : lean === "WAIT"
                ? (
                    <>
                      <strong className="font-medium text-wait">Why WAIT:</strong>{" "}
                      The seats do not agree hard enough to pay the ask, so the paper stays in the pocket. WAIT is the desk&apos;s most common call, on purpose.
                    </>
                  )
                : book.kind === "floor"
                  ? `Paper only: the book fills at ${CHAIR_MIN_ASK_CENTS}¢ or better — a time-boxed trial of a higher floor. ${side} is ${book.ask.toFixed(0)}¢, so this read stays unbooked unless the ask reaches the floor before the window closes. The read still stands and every seat is still graded on it.`
                  : `Paper only: booked at the ${side} ask if it fills, graded on Kalshi's official settlement value.`}
          </p>
          <div className="mt-2 font-mono text-ui text-muted">
            {book.kind === "booked" ? (
              <>
                {book.lean} booked {book.cents.toFixed(1)}¢ · {bookSide} ask now {book.ask.toFixed(1)}¢
              </>
            ) : lean === "WAIT" ? (
              "no paper fill"
            ) : (
              <>
                {side} ask {ask.toFixed(1)}¢
                {book.kind === "floor" ? (
                  <span className="text-wait">
                    {" "}
                    · under the {CHAIR_MIN_ASK_CENTS}¢ floor · no paper fill
                    {bookableShadow(book.ask) ? (
                      <span className="text-subtle"> · {FLOOR_SHADOW_CENTS}¢ shadow books it</span>
                    ) : null}
                  </span>
                ) : null}
                {edge ? ` · edge ${edge >= 0 ? "+" : ""}${edge.toFixed(1)}¢` : ""}
              </>
            )}
          </div>
        </div>
        <div className="council-chair-metrics">
          <div className="council-chair-clock">
            <div className="font-mono text-micro uppercase tracking-widest text-subtle">clock</div>
            <div className="council-chair-clock-value font-mono tabular">
              <MinsLeft closeTime={snap.close_time} />
            </div>
          </div>
          <div>
            <div className="font-mono text-micro uppercase tracking-widest text-subtle">paper</div>
            <div className={cn("council-chair-metric-value font-mono", filled ? "text-fg" : "text-subtle")}>{filled ? "FILL" : "NO FILL"}</div>
          </div>
          <div>
            <div className="font-mono text-micro uppercase tracking-widest text-subtle">
              <Tip k="strip.conf">conf</Tip>
            </div>
            <div className="council-chair-metric-value font-mono tabular">{chair.confidence}</div>
          </div>
          <div>
            <div className="font-mono text-micro uppercase tracking-widest text-subtle">
              <Tip k="strip.size">size</Tip>
            </div>
            <div className="council-chair-metric-value font-mono tabular">{chair.size}</div>
          </div>
        </div>
      </div>
      <details className="council-chair-evidence" key={density} open={density === "full"}>
        <summary>Prices, fees &amp; timestamps</summary>
        <EconomicsBox eco={economicsOf(snap, lean)} />
        {/* Price provenance belongs to the call, not to a section between the call
            and the why: when this was decided, and what is locked. */}
        <CallPrices
          snap={snap}
          chair={chair}
          book={book}
          openFill={(() => {
            const r = openRow(snap, callLog);
            return r ? { t: r.t, cents: r.cents } : null;
          })()}
          tz={tz}
        />
      </details>
      <ChairSignalGauge
        chair={chair}
        feedHealthy={snap.health.spot !== "DOWN" && snap.health.spot !== "STALE" && snap.health.kalshi !== "DOWN" && snap.health.kalshi !== "STALE"}
      />
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span
          className={cn(
            "rounded-sm border px-1.5 py-px font-mono text-micro uppercase tracking-wide tabular",
            gapClear ? "border-up/40 bg-up/10 text-up" : "border-wait/40 bg-wait/10 text-wait",
          )}
          title={signalDescription(signal)}
        >
          {gap == null ? "SIGNAL UNAVAILABLE" : gapClear ? "THRESHOLD MET" : `${Math.abs(gap).toFixed(2)} TO THRESHOLD`}
        </span>
        {failedGates.map((g) => (
          <span key={g.id} className="rounded-sm border border-down/40 bg-down/10 px-1.5 py-px font-mono text-micro uppercase tracking-wide text-down" title={`${g.label}: ${g.value}`}>
            {GATE_CHIP[g.id] ?? g.id.toUpperCase()}
          </span>
        ))}
        {chair.pit_tags.map((t) => (
          <PitChip key={t} tag={t} />
        ))}
        <button type="button" onClick={() => setMathOpen((v) => !v)} className="btn btn-secondary btn-sm ml-auto" aria-expanded={mathOpen}>
          math
        </button>
      </div>
      {mathOpen ? (
        <div className="mt-1.5 space-y-0.5 border-t border-border pt-1.5 font-mono text-micro text-subtle">
          <div>
            sit-mass {chair.sit_mass.toFixed(2)} · agg ×{chair.aggressiveness.toFixed(2)} · diversity ×{chair.diversity.toFixed(2)} · split {chair.conflict_frac.toFixed(2)}
          </div>
          <div className="text-muted">{chair.calc}</div>
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 font-mono text-micro text-muted">
        <span>YES {snap.yes_ask.toFixed(1)}¢ ask</span>
        <span>NO {snap.no_ask.toFixed(1)}¢ ask</span>
        <span>spot {snap.spot.toFixed(0)}</span>
        <span>K {snap.strike.toFixed(0)}</span>
        <span className="truncate">{snap.ticker}</span>
      </div>
      <div className="mt-2 border-t border-border pt-2">
        <MarketChip m={market} tz={tz} />
      </div>
    </section>
  );
}

function fmtCents(n: number) {
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}¢`;
}

/** Chair v2 — the probability chair, running in shadow beside the live chair. */
function ShadowChair({ v2 }: { v2: V2Frame }) {
  const live = v2.live;
  const st = v2.stats;
  const learning = v2.weights_n < V2_MIN_SAMPLES;
  const tone =
    live?.lean === "UP" ? "text-up" : live?.lean === "DOWN" ? "text-down" : "text-wait";
  return (
    <section className="rounded-md border border-dashed border-border bg-surface p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="font-mono text-micro uppercase tracking-widest text-subtle">
          Chair v2 · shadow
        </div>
        <div className="font-mono text-micro text-subtle">
          {learning
            ? `learning the ledger · ${st?.n_graded ?? 0}/${V2_MIN_SAMPLES} windows before it calls`
            : `fit on ${v2.weights_n} windows`}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-end gap-x-6 gap-y-2">
        <div>
          <div className="font-mono text-micro text-subtle">P(UP)</div>
          <div className={cn("font-mono text-title tabular leading-none", tone)}>
            {live ? `${Math.round(live.p_up * 100)}%` : "—"}
          </div>
        </div>
        <div>
          <div className="font-mono text-micro text-subtle">shadow call</div>
          <div className={cn("font-mono text-title tabular leading-none", tone)}>
            {!live
              ? "—"
              : live.lean === "WAIT"
                ? "WAIT"
                : `${live.lean} ${(live.entry_cents ?? 0).toFixed(0)}¢`}
          </div>
          {live ? (
            <div className="mt-1 font-mono text-micro text-muted">
              edge {live.edge_cents == null ? "— (no book)" : `${fmtCents(live.edge_cents)} after fee`}
            </div>
          ) : null}
        </div>
        {st ? (
          <div className="font-mono text-micro text-muted">
            <div>
              v2 {st.calls_v2} calls · net {fmtCents(st.ev_v2)} &nbsp;|&nbsp; chair {st.calls_v1} calls · net{" "}
              {fmtCents(st.ev_v1)}
            </div>
            <div>
              Brier v2 {st.brier_v2 == null ? "—" : st.brier_v2.toFixed(3)} · market{" "}
              {st.brier_market == null ? "—" : st.brier_market.toFixed(3)} · {st.n_graded} graded windows
            </div>
          </div>
        ) : null}
      </div>
      {st ? (
        <div className="mt-2 font-mono text-micro text-muted">
          promotion gate {v2Gates(st).met}/3 · samples {st.n_graded}/{V2_GATE_SAMPLES} · calls{" "}
          {st.calls_v2}/{V2_GATE_CALLS} with net &gt; 0 · Brier {v2Gates(st).brierOk ? "beats" : "trails"} market
        </div>
      ) : null}
      {v2.top.length ? (
        <div className="mt-2 truncate font-mono text-micro text-subtle">
          weights · {v2.top.map(([k, w]) => `${k} ${w >= 0 ? "+" : ""}${w.toFixed(2)}`).join(" · ")}
        </div>
      ) : null}
      <p className="mt-2 font-mono text-micro text-subtle">
        Paper only. One probability learned from the ledger — every seat&apos;s honest read plus the
        market — trading only where it beats the ask by more than the fee, only as far from the market as its
        calibration record has earned, and never under 35¢. It competes with the chair on
        identical windows and is promoted only if it wins.
      </p>
    </section>
  );
}

function fmtBtc(n: number | null): string {
  return n == null || !Number.isFinite(n) ? "—" : Math.round(n).toLocaleString("en-US");
}

function hhmm(t: string, tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(t));
  } catch {
    return t.slice(11, 16);
  }
}

/** The overnight ribbon: what the Chair did in the last 12 hours while you were away, and where BTC went. */
function OvernightRibbon({ brief, tz }: { brief: Brief | null; tz: string }) {
  const [copied, setCopied] = useState(false);
  const o = brief?.overnight;
  const open = o ? fmtBtc(o.btc_open) : "—";
  const now = o ? fmtBtc(o.btc_now) : "—";
  const copyLine = (() => {
    if (!o) return "";
    const btc = o.btc_open != null && o.btc_now != null ? `BTC ${open}→${now}` : "BTC —";
    const line = o.up + o.down === 0 ? `Overnight: Chair WAIT x${o.wait}. ${btc}. No chase.` : `Overnight: Chair ${o.up}U/${o.down}D/${o.wait}W. ${btc}.`;
    return line.length <= 100 ? line : line.slice(0, 100);
  })();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(copyLine);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked; the line is still shown in the title */
    }
  };
  return (
    <section aria-label="Overnight" className="rounded-md border border-border bg-surface px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-mono text-micro uppercase tracking-widest text-subtle">Overnight · 12h</span>
        {o ? (
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-data tabular">
            <span className="text-fg">Chair</span>
            <span className="text-up">{o.up} UP</span>
            <span className="text-subtle">·</span>
            <span className="text-down">{o.down} DOWN</span>
            <span className="text-subtle">·</span>
            <span className="text-wait">{o.wait} WAIT</span>
            <span className="text-subtle">·</span>
            <span className="text-muted">
              BTC {open} <span aria-hidden="true">→</span> {now}
            </span>
            {o.last ? (
              <>
                <span className="text-subtle">·</span>
                <span className="text-muted">
                  last {hhmm(o.last.t, tz)} {o.last.settle == null ? "" : `${o.last.settle.toFixed(0)}¢ `}Chair {o.last.lean}
                </span>
              </>
            ) : null}
          </span>
        ) : (
          <span className="font-mono text-micro text-subtle">reading the overnight tape…</span>
        )}
        {o ? (
          <button type="button" onClick={() => void copy()} className="btn btn-secondary btn-sm ml-auto" title={copyLine}>
            {copied ? "copied" : "copy post"}
          </button>
        ) : null}
      </div>
    </section>
  );
}

/** Chair-only performance, straight from Chair v2's graded sample. WAIT decisions are not calls. */
function ChairScoreboard({ v2 }: { v2?: V2Frame | null }) {
  const st = v2?.stats ?? null;
  const cents = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(0)}¢`);
  const brier = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "—" : n.toFixed(3));
  const bothBrier = st && st.brier_v2 != null && st.brier_market != null;
  return (
    <section aria-label="Chair record" className="rounded-md border border-border bg-surface px-3 py-2 font-mono text-micro">
      <span className="uppercase tracking-widest text-subtle">Chair record</span>{" "}
      <span className="text-muted">
        <span className="text-fg tabular">{st ? st.calls_v1 : "—"}</span> calls · net{" "}
        <span className={cn("tabular", st && st.ev_v1 >= 0 ? "text-up" : st ? "text-down" : "text-subtle")}>{cents(st?.ev_v1)}</span> · Brier{" "}
        <span className="tabular text-fg">{bothBrier ? brier(st!.brier_v2) : "—"}</span> vs market{" "}
        <span className="tabular text-fg">{bothBrier ? brier(st!.brier_market) : "—"}</span> · gate{" "}
        <span className="tabular text-fg">{st ? `${st.calls_v1}/${st.n_graded}` : "—/—"}</span>
      </span>
      <span className="ml-2 text-subtle">· UP/DOWN calls only; WAIT is a decision, not a fill.</span>
    </section>
  );
}

const GAVEL_SIZE_LS = "desk.gavel.size";
function readGavelSize(): GavelSize {
  try {
    const n = Number(localStorage.getItem(GAVEL_SIZE_LS));
    return isGavelSize(n) ? n : 1;
  } catch {
    return 1;
  }
}
function writeGavelSize(n: GavelSize) {
  try {
    localStorage.setItem(GAVEL_SIZE_LS, String(n));
  } catch {
    /* private mode: the choice just doesn't stick */
  }
}

/** GAVEL — Chair reads and the paper book's separate action on each graded window. */
function GavelList({ gavel, tz }: { gavel: GavelRow[]; tz: string }) {
  const [size, setSize] = useState<GavelSize>(1);
  useEffect(() => {
    setSize(readGavelSize());
  }, []);
  const at = (g: GavelRow): number | null => {
    if (g.paper !== "FILLED" || g.settle == null || g.ev == null) return null;
    if (size <= 1 || g.entry == null) return g.ev;
    return evCentsAt(g.entry, g.settle, size);
  };
  return (
    <section className="rounded-md border border-border bg-surface">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <h3 className="font-mono text-micro uppercase tracking-widest text-subtle">
          <Tip k="gavel.list">GAVEL — Chair decisions</Tip>
        </h3>
        <div className="flex items-center gap-2 font-mono text-micro text-subtle">
          <label className="flex items-center gap-1">
            <Tip k="gavel.size">view at</Tip>
            <select
              className="rounded-sm border border-border bg-bg px-1 py-0.5 font-mono text-micro text-fg"
              value={size}
              aria-label="Contracts per filled paper position"
              onChange={(e) => {
                const n = Number(e.target.value);
                if (!isGavelSize(n)) return;
                setSize(n);
                writeGavelSize(n);
              }}
            >
              {GAVEL_SIZES.map((n) => (
                <option key={n} value={n}>
                  {n === 1 ? "1 contract" : `${n.toLocaleString("en-US")} contracts`}
                </option>
              ))}
            </select>
          </label>
          <span>{gavel.length ? `last ${gavel.length}` : ""}</span>
        </div>
      </div>
      {!gavel.length ? (
        <div className="px-3 py-4 font-mono text-ui text-muted">No graded Chair decisions yet.</div>
      ) : (
        <div className="max-h-64 overflow-auto">
          <table className="table-research px-3">
            <thead>
              <tr>
                <th className="pl-3">time</th>
                <th>chair</th>
                <th>paper</th>
                <th className="num"><Tip k="strip.conf">conf</Tip></th>
                <th className="num pr-3">score / bar</th>
              </tr>
            </thead>
            <tbody>
              {gavel.map((g, i) => {
                const v = at(g);
                const paper =
                  g.paper === "FILLED"
                    ? v == null
                      ? "FILLED"
                      : `FILLED · ${fmtCentsAt(v, size)}`
                    : g.paper === "SKIPPED"
                      ? "SKIP"
                      : "—";
                return (
                  <tr key={`${g.t}-${i}`}>
                    <td className="whitespace-nowrap pl-3 text-muted">{hhmm(g.t, tz)}</td>
                    <td>
                      <span className={cn("font-medium", g.lean === "UP" ? "text-up" : g.lean === "DOWN" ? "text-down" : "text-wait")}>{g.lean}</span>
                    </td>
                    <td
                      className={cn(
                        "whitespace-nowrap font-mono text-micro",
                        g.paper === "FILLED" ? (v != null && v < 0 ? "text-down" : "text-up") : "text-subtle",
                      )}
                      title={
                        g.paper === "FILLED"
                          ? "The paper book recorded this Chair read."
                          : g.paper === "SKIPPED"
                            ? "The Chair read stood, but the paper book did not record a position."
                            : "No directional Chair read was recorded for this window."
                      }
                    >
                      {paper}
                    </td>
                    <td className="num tabular text-muted">{g.conf}</td>
                    <td className="num tabular pr-3 text-muted">
                      {g.score >= 0 ? "+" : ""}
                      {g.score.toFixed(2)} / {g.bar.toFixed(2)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="border-t border-border px-3 py-1.5 font-mono text-micro text-subtle">
        UP/DOWN is the Chair read. FILLED means the paper book recorded it. SKIP means the read stood but no paper position was taken; skipped reads never enter paper P&amp;L.
        {size > 1 ? ` Filled P&L is shown at ${size.toLocaleString("en-US")} contracts, assuming the ask holds.` : ""}
      </p>
    </section>
  );
}

/** SEATS — specialist paper fills only, collapsed. A seat +2¢ is never a Chair +2¢. */
function SeatsList({ rows, learner }: { rows: SeatRow[]; learner: import("@/lib/desk/types").Learner }) {
  const withFills = rows
    .map((r) => ({ r, st: readScalp(learner, r.seat) }))
    .filter((x) => x.st.legs.length > 0)
    .sort((a, b) => b.st.legs.length - a.st.legs.length);
  return (
    <details className="group rounded-md border border-border bg-surface">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 font-mono text-micro uppercase tracking-widest text-subtle marker:content-none hover:text-fg">
        <span>
          <Tip k="seats.list">SEATS — specialist paper fills</Tip> · {withFills.length} with fills
        </span>
        <span aria-hidden="true" className="transition-transform duration-200 ease-out group-open:rotate-90">▸</span>
      </summary>
      <div className="border-t border-border px-3 py-2">
        <p className="mb-2 font-mono text-micro text-subtle">Each seat&apos;s own paper scalps in cents — specialist practice, not the Chair&apos;s book. These do not settle windows and are never Chair calls.</p>
        {!withFills.length ? (
          <div className="font-mono text-ui text-muted">No specialist fills yet.</div>
        ) : (
          <table className="table-research">
            <thead>
              <tr>
                <th>seat</th>
                <th className="num">fills</th>
                <th className="num">avg ¢</th>
                <th>recent</th>
              </tr>
            </thead>
            <tbody>
              {withFills.map(({ r, st }) => {
                const avg = scalpAvg(st.legs);
                return (
                  <tr key={r.seat}>
                    <td className="text-fg">
                      {r.seat} <span className="text-subtle">{r.callsign}</span>
                    </td>
                    <td className="num tabular text-muted">{st.legs.length}</td>
                    <td className={cn("num tabular", avg == null ? "text-subtle" : avg >= 0 ? "text-up" : "text-down")}>
                      {avg == null ? "—" : `${avg >= 0 ? "+" : ""}${avg.toFixed(1)}`}
                    </td>
                    <td className="font-mono text-micro tabular text-subtle">
                      {st.legs.slice(-8).map((c, i) => (
                        <span key={i} className={c >= 0 ? "text-up" : "text-down"}>
                          {c >= 0 ? "+" : ""}
                          {c.toFixed(0)}
                          {i < Math.min(8, st.legs.length) - 1 ? " " : ""}
                        </span>
                      ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </details>
  );
}

export function SatoshiTab({
  snap,
  chair,
  settings,
  callLog,
  onJump,
  v2,
  onOpenArena,
  onOpenBooks,
  density,
  onDensityChange,
  strip,
}: {
  snap: Snapshot;
  chair: ChairResult;
  settings: Settings;
  callLog: CallLogRow[];
  onJump: (seat: SeatId) => void;
  v2?: V2Frame | null;
  onOpenArena?: () => void;
  /** Switch to the BOOKS tab. The record card links there rather than embedding it. */
  onOpenBooks?: () => void;
  density: FloorDensity;
  onDensityChange: (density: FloorDensity) => void;
  /** The decision-metrics strip, shown right under the chair stage. */
  strip?: ReactNode;
}) {
  const [view, setView] = useState<"all" | "speaking" | "live">("all");
  const learner = useDesk().learner;
  const [brief, setBrief] = useState<Brief | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => {
      fetchBrief()
        .then((b) => alive && setBrief(b))
        .catch(() => {
          /* the ribbon and GAVEL show their empty state; the rest of the floor is unaffected */
        });
    };
    load();
    const id = window.setInterval(load, 60_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);
  const speaking = chair.rows.filter((r) => r.lean === "UP" || r.lean === "DOWN").length;
  const book = bookState(snap, chair.lean, callLog);
  const why = whyFacts(chair, plainLine(chair, snap, book));
  const record = recordCard(brief?.gavel ?? [], FLOOR_LIVE_SINCE);
  const lastSettled =
    [...callLog].filter((r) => r.settle != null).sort((a, b) => b.close_time - a.close_time)[0] ?? null;
  const rows = chair.rows.filter((r) => (view === "all" ? true : view === "speaking" ? r.lean === "UP" || r.lean === "DOWN" : r.status === "LIVE"));
  return (
    <div className="gutter mx-auto flex w-full max-w-[var(--max)] flex-col gap-4 py-4">
      {density === "full" ? <OvernightRibbon brief={brief} tz={settings.tz} /> : null}

      <CouncilFloorRoom lean={chair.lean} density={density}>
        <ChairBoard snap={snap} chair={chair} tz={settings.tz} callLog={callLog} density={density} />
      </CouncilFloorRoom>
      {density === "full" && strip ? <div>{strip}</div> : null}

      <WhyBlock why={why} chair={chair} />
      <ChairEyes snap={snap} />

      <section className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-surface px-3 py-2.5" aria-label="Floor density">
        <div>
          <div className="font-mono text-micro uppercase tracking-widest text-subtle">
            {density === "quiet" ? "Quiet Floor" : "Full Floor"}
          </div>
          <p className="mt-0.5 font-sans text-ui text-muted">
            Quiet keeps the call, reason, clock and live Bitcoin-vs-strike view. Full adds evidence, record, council and diagnostics.
          </p>
        </div>
        <div role="group" aria-label="Choose Floor density" className="flex gap-1">
          {(["quiet", "full"] as const).map((choice) => (
            <button
              key={choice}
              type="button"
              aria-pressed={density === choice}
              onClick={() => onDensityChange(choice)}
              className={cn("btn btn-sm", density === choice ? "btn-secondary text-fg" : "text-muted hover:text-fg")}
            >
              {choice === "quiet" ? "Quiet" : "Full desk"}
            </button>
          ))}
        </div>
      </section>

      {density === "full" ? (
        <>
      <EvidenceBlock why={why} />

      <div className="grid gap-3 lg:grid-cols-2">
        <ArenaPanel snap={snap} live={settings.source === "live"} onOpenArena={onOpenArena ?? (() => {})} />
        <LastReplayCard
          ticker={lastSettled?.ticker ?? null}
          at={lastSettled ? new Date(lastSettled.close_time).toISOString() : null}
          lean={lastSettled?.lean ?? null}
          settle={lastSettled?.settle ?? null}
          tz={settings.tz}
        />
      </div>

      <CompactRecord card={record} onBooks={onOpenBooks ?? (() => {})} />

      <Chamber rows={chair.rows} onJump={onJump} />
      <ChairScoreboard v2={v2} />
      <div className="grid gap-3 lg:grid-cols-2">
        <GavelList gavel={brief?.gavel ?? []} tz={settings.tz} />
        <SeatsList rows={chair.rows} learner={learner} />
      </div>

      <details className="group rounded-md border border-border bg-surface">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 font-mono text-micro uppercase tracking-widest text-subtle marker:content-none hover:text-fg">
          <span>Diagnostics · chair v2, the score math, and the full seat table</span>
          <span aria-hidden="true" className="transition-transform duration-200 ease-out group-open:rotate-90">▸</span>
        </summary>
        <div className="flex flex-col gap-3 border-t border-border p-3">
      {v2 ? <ShadowChair v2={v2} /> : null}

      <div className="flex flex-wrap items-center gap-2 font-mono text-micro">
        <span className="text-subtle">
          <Tip k="pane.seats">the voting seats</Tip> · {speaking} speaking · {chair.rows.length - speaking} sitting
        </span>
        <div role="group" aria-label="Which seats to show" className="ml-auto flex gap-1">
          {(["all", "speaking", "live"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className={cn(
                "btn btn-sm",
                view === v ? "btn-secondary text-fg" : "text-muted hover:text-fg",
              )}
            >
              {v === "all" ? `all ${chair.rows.length}` : v === "speaking" ? "speaking" : "LIVE skills"}
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[72rem] text-left">
          <thead className="bg-surface-2 font-mono text-micro uppercase tracking-wider text-subtle">
            <tr>
              {(
                [
                  ["Rank", "col.rank"],
                  ["Avg ¢", "col.scalp"],
                  ["Cal", "col.calib"],
                  ["Calls", "field.calls"],
                  ["Seat", "col.seat"],
                  ["Callsign", "col.callsign"],
                  ["Lean", "col.lean"],
                  ["Conf", "col.conf"],
                  ["Skill used", "col.skill"],
                  ["Base w", "col.base"],
                  ["Listen", "col.listen"],
                  ["Health", "col.health"],
                  ["Signed", "col.signed"],
                  ["Contribution", "col.contrib"],
                  settings.show_shadow ? ["Shadow", "col.shadow"] : null,
                  ["Why", "col.why"],
                  ["Status", "col.status"],
                ] as ([string, string] | null)[]
              )
                .filter(Boolean)
                .map((h) => (
                  <th key={h![0]} className="whitespace-nowrap px-2 py-1.5 font-medium">
                    <Tip k={h![1]}>{h![0]}</Tip>
                  </th>
                ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const maxC = Math.max(...chair.rows.map((x) => Math.abs(x.contribution)), 0.001);
              const pct = (Math.abs(r.contribution) / maxC) * 50;
              return (
                <tr
                  key={r.seat}
                  onClick={() => onJump(r.seat)}
                  className="cursor-pointer border-t border-border hover:bg-surface-2"
                >
                  <td className="px-2 py-1 font-mono text-data tabular text-muted">
                    {r.rank}
                    {r.wilson_rank !== r.contrib_rank && r.wilson_rank < 90 ? (
                      <span className="text-subtle"> · W{r.wilson_rank}</span>
                    ) : null}
                  </td>
                  <td
                    className={cn(
                      "px-2 py-1 font-mono text-data tabular",
                      r.scalp_avg == null ? "text-subtle" : r.scalp_avg >= 0 ? "text-up" : "text-down",
                    )}
                  >
                    {r.scalp_avg == null ? "—" : `${r.scalp_avg >= 0 ? "+" : ""}${r.scalp_avg.toFixed(1)}`}
                    {r.scalp_n ? <span className="text-subtle"> · {r.scalp_n}</span> : null}
                  </td>
                  <td className="px-2 py-1 font-mono text-data tabular text-muted">
                    {Math.round(r.calib * 100)}%
                    <span className="text-subtle">
                      {" "}
                      {r.calib_n}/{FULL_N}
                    </span>
                  </td>
                  <td className="px-2 py-1 font-mono text-data tabular text-fg">{r.calls}</td>
                  <td className="px-2 py-1 font-mono text-data text-fg">
                    <Tip k={`seat.${r.seat}`} mark={false}>
                      {r.seat}
                    </Tip>
                  </td>
                  <td className="px-2 py-1 font-mono text-data text-muted">{r.callsign}</td>
                  <td className="px-2 py-1">
                    <LeanChip lean={r.lean} cents={sideAsk(snap, r.lean)} />
                  </td>
                  <td className="px-2 py-1 font-mono text-data tabular">{r.conf}</td>
                  <td className="px-2 py-1 font-mono text-micro text-muted">{r.skill_used}</td>
                  <td className="px-2 py-1 font-mono text-micro tabular text-muted">
                    {r.base_w.toFixed(2)}
                  </td>
                  <td className="px-2 py-1 font-mono text-micro tabular text-muted">
                    {r.listen.toFixed(2)}
                  </td>
                  <td className="px-2 py-1 font-mono text-micro text-muted">{r.health}</td>
                  <td
                    className={cn(
                      "px-2 py-1 font-mono text-micro tabular",
                      r.signed > 0 ? "text-up" : r.signed < 0 ? "text-down" : "text-muted",
                    )}
                  >
                    {r.signed >= 0 ? "+" : ""}
                    {r.signed.toFixed(3)}
                  </td>
                  <td className="px-2 py-1">
                    <div className="flex items-center gap-2">
                      <div className="relative h-1.5 w-24 overflow-hidden rounded-sm bg-surface-3">
                        <div className="absolute inset-y-0 left-1/2 w-px bg-border-strong" />
                        <div
                          className={cn(
                            "absolute inset-y-0 transition-all duration-500 ease-out",
                            r.contribution >= 0 ? "bg-up" : "bg-down",
                          )}
                          style={
                            r.contribution >= 0
                              ? { left: "50%", width: `${pct}%` }
                              : { right: "50%", width: `${pct}%` }
                          }
                        />
                      </div>
                      <Mono
                        className={cn(
                          "text-micro",
                          r.contribution > 0 ? "text-up" : r.contribution < 0 ? "text-down" : "text-muted",
                        )}
                      >
                        {r.contribution >= 0 ? "+" : ""}
                        {r.contribution.toFixed(3)}
                      </Mono>
                    </div>
                  </td>
                  {settings.show_shadow && (
                    <td className="px-2 py-1">
                      {r.shadow_lean ? (
                        <LeanChip lean={r.shadow_lean} cents={sideAsk(snap, r.shadow_lean)} />
                      ) : (
                        <span className="text-subtle">—</span>
                      )}
                    </td>
                  )}
                  <td className="max-w-xs truncate px-2 py-1 font-sans text-ui text-muted" title={r.why}>
                    {r.why}
                  </td>
                  <td className="px-2 py-1">
                    <StatusChip s={r.status} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <Pane title={<Tip k="pane.score">Score math</Tip>}>
          <div className="space-y-1 font-mono text-data">
            <div>
              score = Σ(signed × w) / Σw_dir ={" "}
              <span className={chair.score >= 0 ? "text-up" : "text-down"}>
                {chair.score.toFixed(3)}
              </span>
            </div>
            <div>
              sit-mass {chair.sit_mass.toFixed(2)} → bar +{(0.2 * chair.sit_mass).toFixed(3)}
            </div>
            <div>
              conflict-frac {chair.conflict_frac.toFixed(2)} → ×
              {(1 - 0.7 * chair.conflict_frac).toFixed(2)}
            </div>
            <div>confluence bar {chair.bar.toFixed(2)} (floor 0.24 / ceil 0.72)</div>
            <div>aggressiveness ×{chair.aggressiveness.toFixed(2)}</div>
            <div>diversity ×{chair.diversity.toFixed(2)} ({chair.categories_agree} cats)</div>
            <div>fade / structure / tape {chair.fade_fold}</div>
            <div>
              size {chair.size} · {chair.size_note}
            </div>
            <div>invert cap {chair.invert_cap}</div>
            <div>LAW dimmer {chair.law_dimmer}</div>
            <div className={chair.tax_applied ? "text-wait" : "text-muted"}>
              calibration tax: {chair.tax}
            </div>
            <div>cousins {chair.knn_note}</div>
            <div>{chair.wait_note}</div>
            {chair.walk ? (
              <div>
                walk-forward n={chair.walk.n} · train {Math.round(chair.walk.train_hit * 100)}%{" "}
                {chair.walk.train_ev >= 0 ? "+" : ""}
                {chair.walk.train_ev.toFixed(1)}¢ · later {Math.round(chair.walk.test_hit * 100)}%{" "}
                {chair.walk.test_ev >= 0 ? "+" : ""}
                {chair.walk.test_ev.toFixed(1)}¢
              </div>
            ) : (
              <div>walk-forward needs 16 graded chair calls</div>
            )}
            <div>
              full-call conf min(92, round(50+|score|×55)) = {chair.full_conf_raw}
              {chair.lean === "WAIT" ? " · WAIT uses gate conf" : ""} → {chair.confidence} conf
              {chair.lean !== "WAIT" ? ` · call ${sideAsk(snap, chair.lean).toFixed(0)}¢` : ""}
            </div>
          </div>
        </Pane>
        <Pane title={<Tip k="pane.gates">Gate checklist</Tip>}>
          <ul className="space-y-1">
            {chair.gates.map((g) => (
              <li key={g.id} className="flex items-start justify-between gap-2 font-mono text-data">
                <span className={g.pass ? "text-up" : g.hard ? "text-down" : "text-wait"}>
                  {g.pass ? "PASS" : "FAIL"}
                </span>
                <span className="min-w-0 flex-1 text-muted">
                  {g.label}
                  <span className="block text-micro text-subtle">{g.value}</span>
                </span>
              </li>
            ))}
          </ul>
        </Pane>
        <Pane title={<Tip k="pane.thinking">Chair thinking</Tip>}>
          <div className="space-y-1.5">
            <Field k="phase" v={snap.phase} />
            <Field k="hypothesis" v={chair.hypothesis} />
            <Field
              k="evidence"
              v={
                <ul className="space-y-0.5">
                  {chair.evidence.length ? chair.evidence.map((e) => <li key={e}>{e}</li>) : "—"}
                </ul>
              }
            />
            <Field k="counter" v={chair.counter} />
            <Field k="decision" v={chair.decision} />
            <Field k="invalidate if" v={invalidateCondition(chair.invalidate_if)} />
            <Field k="calc" v={<span className="font-mono text-data">{chair.calc}</span>} />
            <Field k="skill / huddle" v={`${chair.last_settle} / ${chair.huddle_line}`} />
          </div>
        </Pane>
      </div>
        </div>
      </details>
        </>
      ) : null}
    </div>
  );
}

export function MetaFooter({
  chair,
  law_wrongs,
  lockdown,
  lockdown_until,
  tape,
  settling,
}: {
  chair: ChairResult | null;
  law_wrongs: number;
  lockdown: boolean;
  lockdown_until: number;
  tape: string[];
  settling?: boolean;
}) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const left = now == null ? null : Math.max(0, Math.round((lockdown_until - now) / 1000));
  return (
    <div className="border-t border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 font-mono text-data">
        <div>
          <span className="text-micro uppercase text-subtle">
            <Tip k="footer.quorum">Quorum </Tip>
          </span>
          {chair ? (
            <>
              <span className="text-up">UP {chair.quorum.up}</span>
              <span className="text-subtle"> · </span>
              <span className="text-down">DOWN {chair.quorum.down}</span>
              <span className="text-subtle"> · </span>
              <span className="text-wait">WAIT {chair.quorum.wait}</span>
            </>
          ) : (
            <span className="text-muted">waiting for the current-window vote</span>
          )}
        </div>
        <div>
          <span className="text-micro uppercase text-subtle">
            <Tip k="footer.law">Law </Tip>
          </span>
          <span className={lockdown ? "text-down" : "text-muted"}>
            {law_wrongs} consecutive wrongs · lock {lockdown ? "ON" : "off"}
            {lockdown && left != null && left > 0 ? ` ${left}s` : ""}
          </span>
        </div>
      </div>
      {tape[0] && (
        <div className="border-t border-border px-3 py-1 font-mono text-micro text-muted">
          <span className="text-subtle">
            <Tip k="footer.tape">SETTLE TAPE</Tip>
            {" · "}
          </span>
          <span className={settling || tape[0].startsWith("PENDING") ? "text-wait" : undefined}>
            {tape[0]}
          </span>
        </div>
      )}
    </div>
  );
}
