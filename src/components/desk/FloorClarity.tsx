/**
 * The Stage 1 Floor sections: PRICES, WHY, EVIDENCE, LAST REPLAY and the RECORD.
 *
 * Every number here comes from `floor-clarity.ts`, which is pure and tested. These
 * components do no arithmetic of their own beyond formatting, fetch nothing, hold no
 * timers, and decide nothing — the Chair's answer arrives already made. Keeping the
 * judgement in the helper and only the markup here is what makes the truthfulness
 * claims testable.
 */
import { Pane } from "./bits";
import { Tip } from "./Tip";
import { cn } from "@/lib/utils";
import { CHAIR_MIN_ASK_CENTS } from "@/lib/desk/book-floor";
import {
  chairConfidenceLabel,
  floorLine,
  freshness,
  invalidateLine,
  displayedPriceFacts,
  priceFacts,
  type PriceFact,
  type RecordCard,
  type WhyFacts,
} from "@/lib/desk/floor-clarity";
import type { BookState } from "@/lib/desk/book-floor";
import type { ChairResult, Snapshot } from "@/lib/desk/types";

function clock(ms: number | null, tz: string): string {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return "—";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZone: tz,
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString().slice(11, 19);
  }
}

/**
 * One price, with its kind and its moment. An unavailable price shows a dash and the
 * reason — never a zero, which a reader would take for a real quote.
 */
function PriceCell({ f, tz }: { f: PriceFact; tz: string }) {
  const has = f.cents != null;
  return (
    <div className="min-w-0">
      <div className="font-mono text-micro uppercase tracking-wider text-subtle">{f.label}</div>
      <div
        className={cn("font-mono tabular text-data leading-none", has ? "text-fg" : "text-subtle")}
        // The kind is in the accessible name too, so a screen reader never hears a
        // bare "82" next to a bare "88".
        aria-label={`${f.label}: ${has ? `${f.cents!.toFixed(1)} cents` : "unavailable"}`}
      >
        {has ? `${f.cents!.toFixed(1)}¢` : "—"}
      </div>
      <div className="mt-1 font-mono text-micro leading-snug text-muted">
        {has ? (
          <>
            {f.at != null ? <span className="text-subtle">{clock(f.at, tz)} · </span> : null}
            {f.note}
          </>
        ) : (
          <span className="text-wait">unavailable — {f.unavailable_why}</span>
        )}
      </div>
    </div>
  );
}

/**
 * The four prices together, plus what is and is not known about the clock.
 *
 * This is the section that answers the brief's failure condition: a 52¢ and a 65¢ can
 * both be on screen, but each says which kind of number it is and which moment it
 * belongs to, so they can never read as the same quantity disagreeing with itself.
 */
export function CallPrices({
  snap,
  chair,
  book,
  openFill,
  tz,
}: {
  snap: Snapshot;
  chair: ChairResult;
  book: BookState;
  openFill: { t: number; cents: number } | null;
  tz: string;
}) {
  // Only the two the Chair card's economics box does not already carry. FAIR and ASK
  // live there, together and labelled; drawing them again here would create a second
  // source for the same number.
  const facts = displayedPriceFacts(priceFacts(snap, chair, book, openFill));
  const fresh = freshness(snap);
  const feedTone =
    fresh.feed === "LIVE" ? "text-up" : fresh.feed === "STALE" ? "text-wait" : "text-down";
  // A NESTED DIV, NOT A SIBLING SECTION. This renders INSIDE the Chair stage, directly
  // under the economics box it complements, exactly as EconomicsBox does. As its own
  // <section> in the Floor's gap-4 list it became a distinct card with its own ARIA
  // landmark sitting between the CALL and the WHY — which displaced WHY from being the
  // first explanatory section after the call. Price provenance belongs to the call
  // presentation, so it lives in the call block.
  return (
    <div className="mt-3 rounded-md border border-border bg-bg/40 px-3 py-2.5" data-floor-prices>
      <div className="font-mono text-micro uppercase tracking-widest text-subtle">
        <Tip k="chair.economics">when this was decided, and what is locked</Tip>
      </div>
      <div className="mt-2.5 grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
        {facts.map((f) => (
          <PriceCell key={f.kind} f={f} tz={tz} />
        ))}
      </div>
      <div className="mt-2.5 border-t border-border pt-2 font-mono text-micro leading-relaxed text-muted">
        <span className={cn("uppercase tracking-wide", feedTone)}>feed {fresh.feed.toLowerCase()}</span>
        {" · "}
        {/*
          Deliberately phrased as receipt and movement, never as "the quote is N
          seconds fresh". The exchange's own stamp is not available from this feed —
          see Freshness.source_time_available — and claiming it would be the exact
          manufactured-freshness the brief forbids.
        */}
        {fresh.note}
        {fresh.gap !== "ok" ? <span className="text-wait"> · feed continuity: {fresh.gap}</span> : null}
      </div>
      <div className="mt-1.5 font-mono text-micro leading-relaxed text-subtle">
        Fair value and the current ask are in &ldquo;what this call costs&rdquo; above — fair
        value is DERIVED by the desk&rsquo;s model, the ask is what the market quotes. {floorLine()}
      </div>
    </div>
  );
}

/**
 * WHY, immediately under the call.
 *
 * Recorded fields only. The wait reason distinguishes a failed hard gate from a thin
 * score from a legitimate abstention, because those are three different answers with
 * three different remedies — and when more than one thing is missing it says so
 * rather than implying that clearing the one named gate would produce a call.
 */
export function WhyBlock({ why, chair }: { why: WhyFacts; chair: ChairResult }) {
  const conf = chairConfidenceLabel(chair);
  const waitLine =
    why.wait_reason === "feed-condition"
      ? `The data cannot be trusted right now: ${why.feed_gates.map((g) => `${g.label} (${g.value})`).join(", ")}. Until the inputs are believable the vote does not mean anything, so the desk does not call. This is a feed condition, not a read on the market.`
      : why.wait_reason === "hard-gate"
      ? why.failed_hard.length === 1 && !why.more_than_one_thing_missing
        ? `A hard gate is failing: ${why.failed_hard[0]!.label} (${why.failed_hard[0]!.value}). Clearing it is necessary, not sufficient — the score still has to beat the bar.`
        : `More than one thing is missing: ${why.failed_hard.map((g) => `${g.label} (${g.value})`).join(", ")}${why.failed_hard.length && Math.abs(chair.score) < chair.bar ? ", and the score is under the bar" : ""}.`
      : why.wait_reason === "under-bar"
        ? "No gate is failing; the weighted vote simply does not clear its own bar."
        : why.wait_reason === "no-edge"
          ? "Gates pass and the vote clears, yet the desk still sees nothing worth paying the ask for. WAIT is a decision, not a failure."
          : "";
  return (
    <Pane title={<Tip k="pane.thinking">why</Tip>} className="min-w-0">
      <div className="flex flex-col gap-2">
        {why.hypothesis ? (
          <p className="max-w-[68ch] font-sans text-ui leading-snug text-fg">{why.hypothesis}</p>
        ) : null}
        {waitLine ? <p className="max-w-[68ch] font-sans text-ui leading-snug text-wait">{waitLine}</p> : null}
        {why.wait_note ? (
          <p className="max-w-[68ch] font-mono text-micro leading-relaxed text-muted">{why.wait_note}</p>
        ) : null}
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 font-mono text-micro text-subtle">
          <span>
            seats {why.quorum.up} up · {why.quorum.down} down · {why.quorum.wait} sitting
          </span>
          <span>
            {/*
              The label names the quantity. "76 conf" must never be readable as a 76%
              chance of winning: it is a margin over a bar, and the gloss says so.
            */}
            <Tip k="strip.conf">gate confidence</Tip> {conf.value}{" "}
            <span className="text-muted">— {conf.gloss}</span>
          </span>
          <span>
            {why.failed_hard.length
              ? `${why.failed_hard.length} hard gate${why.failed_hard.length === 1 ? "" : "s"} failing`
              : `all ${why.gates.filter((g) => g.hard).length} hard gates pass`}
          </span>
        </div>
      </div>
    </Pane>
  );
}

/** Evidence for, evidence against, and the condition that would end the read. */
export function EvidenceBlock({ why }: { why: WhyFacts }) {
  const invalid = invalidateLine(why);
  const nothing = !why.evidence.length && !why.counter && !invalid;
  return (
    <Pane title={<Tip k="pane.gates">evidence · counterargument</Tip>} className="min-w-0">
      {nothing ? (
        <p className="font-mono text-micro text-subtle">
          Nothing recorded for this window yet.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="min-w-0">
            <div className="font-mono text-micro uppercase tracking-wider text-subtle">for</div>
            {why.evidence.length ? (
              <ul className="mt-1 flex flex-col gap-1">
                {why.evidence.map((e, i) => (
                  <li key={`${i}-${e}`} className="font-mono text-micro leading-relaxed text-fg">
                    {e}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 font-mono text-micro text-subtle">none recorded</p>
            )}
          </div>
          <div className="min-w-0">
            <div className="font-mono text-micro uppercase tracking-wider text-subtle">against</div>
            <p className="mt-1 font-mono text-micro leading-relaxed text-fg">
              {why.counter || <span className="text-subtle">none recorded</span>}
            </p>
            {invalid ? (
              <p className="mt-2 font-mono text-micro leading-relaxed text-wait">
                {/*
                  invalidateLine only ever phrases this as what ENDS the read. It is
                  not an entry trigger and must never be presented as one.
                */}
                {invalid}
              </p>
            ) : null}
          </div>
        </div>
      )}
    </Pane>
  );
}

/**
 * The last settled window, as a link to the replay page that already exists.
 *
 * DELIBERATELY A LINK, NOT AN EMBEDDED PANE. `ReplayPane` fetches on mount, so
 * rendering it here would add a network round-trip to every Floor load for a window
 * the visitor has not asked to inspect. The replay itself is unchanged at
 * /window/<ticker>; this is the signpost to it.
 */
export function LastReplayCard({
  ticker,
  at,
  lean,
  settle,
  tz,
}: {
  ticker: string | null;
  at: string | null;
  lean: "UP" | "DOWN" | "WAIT" | null;
  settle: number | null;
  tz: string;
}) {
  const href = ticker ? `/window/${encodeURIComponent(ticker)}` : null;
  const won = settle != null && lean !== "WAIT" && lean != null ? settle >= 50 === (lean === "UP") : null;
  return (
    <Pane title={<Tip k="pane.replay">last settled window</Tip>} className="min-w-0">
      {href ? (
        <div className="flex flex-col gap-1.5">
          <div className="font-mono text-ui text-fg">
            {at ? <span className="text-subtle">{clock(Date.parse(at), tz)} · </span> : null}
            {lean ?? "—"}
            {settle != null ? (
              <span className={cn("ml-2", won === true ? "text-up" : won === false ? "text-down" : "text-subtle")}>
                settled {settle.toFixed(0)}¢
              </span>
            ) : null}
          </div>
          <a
            href={href}
            className="w-fit rounded-sm border border-border px-2 py-1 font-mono text-micro uppercase tracking-wide text-subtle hover:text-fg"
          >
            open the replay →
          </a>
        </div>
      ) : (
        <p className="font-mono text-micro text-subtle">No settled window recorded yet.</p>
      )}
    </Pane>
  );
}

/**
 * The compact record: one population, named, with its own bound stated.
 *
 * It is NOT the desk's lifetime record — BOOKS is. The population line says what was
 * counted and over what window, so the two figures differing is an understood
 * difference rather than an unexplained discrepancy. A missing figure prints
 * "unavailable" with the reason; none is invented to complete the card.
 */
export function CompactRecord({ card, onBooks }: { card: RecordCard; onBooks: () => void }) {
  const cell = (label: string, value: string, tone?: string, tip?: string) => (
    <div key={label} className="min-w-0">
      <div className="font-mono text-micro uppercase tracking-wider text-subtle">
        {tip ? <Tip k={tip}>{label}</Tip> : label}
      </div>
      <div className={cn("font-mono tabular text-ui", tone ?? "text-fg")}>{value}</div>
    </div>
  );
  const signed = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}¢`;
  const beaten = card.win_pct != null && card.breakeven_pct != null ? card.win_pct >= card.breakeven_pct : null;
  return (
    <section aria-label="Record" className="rounded-md border border-border bg-surface px-3 py-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="font-mono text-micro uppercase tracking-widest text-subtle">
          <Tip k="pane.books">the record</Tip>
        </div>
        <button
          type="button"
          onClick={onBooks}
          className="rounded-sm border border-border px-2 py-0.5 font-mono text-micro uppercase tracking-wide text-subtle hover:text-fg"
        >
          full books →
        </button>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-3 lg:grid-cols-6">
        {cell(
          "paper net",
          card.net_cents == null ? "unavailable" : signed(card.net_cents),
          card.net_cents == null ? "text-wait" : card.net_cents >= 0 ? "text-up" : "text-down",
        )}
        {cell("n", String(card.n))}
        {cell("won", card.win_pct == null ? "unavailable" : `${card.win_pct}%`, card.win_pct == null ? "text-wait" : undefined)}
        {cell(
          "needs",
          card.breakeven_pct == null ? "unavailable" : `${card.breakeven_pct}%`,
          card.breakeven_pct == null ? "text-wait" : beaten ? "text-up" : "text-down",
          "books.breakeven",
        )}
        {cell("unit", card.unit)}
        {cell(
          "from",
          card.from && card.to
            ? `${card.from.slice(5, 10)} → ${card.to.slice(5, 10)}`
            : "unavailable",
          card.from ? undefined : "text-wait",
        )}
      </div>
      <div className="mt-2 font-mono text-micro leading-relaxed text-muted">
        {/* One identified population, and the reason it is not the lifetime total. */}
        counts {card.n_means} · {card.population}. BOOKS holds the full record with its own era
        splits, so these figures are narrower than the ones there by design.
        {card.unavailable_why ? <span className="text-wait"> {card.unavailable_why}.</span> : null}
      </div>
    </section>
  );
}

/** Where the floor statement belongs when prices are not on screen. */
export const FLOOR_NOTE = `The paper book fills at ${CHAIR_MIN_ASK_CENTS}¢ or better.`;
