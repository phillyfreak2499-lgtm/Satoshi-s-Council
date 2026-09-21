/**
 * SECTION 10 — the paper book, kept visibly apart from the live opinion.
 *
 * Three states a reader must be able to tell apart at a glance: what SATOSHI
 * says NOW, whether the book actually HOLDS something, and what price it was
 * actually BOOKED at. A directional read is not a fill — the floor and the
 * book's own timing sit between them — so the card states each separately and
 * never reconciles them into one line.
 */
import type { ProFloorFacts } from "@/lib/desk/pro-floor";
import { Panel, StatBox } from "./panels";
import { leanTone } from "./tones";

function stamp(t: number | null): string {
  if (t == null) return "time not recorded";
  try {
    return `${new Date(t).toISOString().slice(11, 19)} UTC`;
  } catch {
    return "time not recorded";
  }
}

export function PaperPositionCard({ facts, full }: { facts: ProFloorFacts; full: boolean }) {
  const p = facts.paper;
  const lean = facts.conclusion.lean;
  return (
    <Panel
      id="paper"
      title="Paper book"
      note="Paper only. A read is an opinion; a position is something the book already did. They are not the same event and are never merged here."
    >
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <StatBox
          label="current read"
          value={lean}
          tone={leanTone(lean)}
          sub="what SATOSHI says on this frame"
        />
        <StatBox
          label="paper position"
          value={p.held ? "HELD" : "NONE"}
          tone={p.held ? "text-fg" : "text-subtle"}
          sub={p.held ? `${p.entry_side} on this window` : p.no_position_why}
        />
        <StatBox
          label="entry"
          value={p.entry_cents == null ? "—" : `${p.entry_cents.toFixed(1)}¢`}
          sub={p.held ? `locked ${stamp(p.entry_at)}` : "nothing booked on this window"}
        />
      </div>

      {p.held ? (
        <p className="mt-3 max-w-[80ch] font-sans text-ui leading-relaxed text-muted">
          The book holds {p.entry_side} at {p.entry_cents?.toFixed(1) ?? "—"}¢
          {p.ask_now == null ? "" : `, and that side's ask is ${p.ask_now.toFixed(1)}¢ now`}. One position per window, so
          the held side does not change when the read does
          {p.entry_side && p.entry_side !== lean ? ` — and right now it does differ from the ${lean} read above` : ""}.
        </p>
      ) : (
        <p className="mt-3 max-w-[80ch] font-sans text-ui leading-relaxed text-muted">
          Nothing is held on this window. {p.no_position_why}. A read under the {p.floor_cents}¢ floor still stands and
          still grades every seat; it simply does not fill.
        </p>
      )}

      {full ? (
        <p className="mt-2 font-mono text-micro leading-relaxed text-subtle">
          Book state: {p.state.kind}. Floor {p.floor_cents}¢. Paper only — no live orders, and nothing here is a
          recommendation to take a position.
        </p>
      ) : null}
    </Panel>
  );
}
