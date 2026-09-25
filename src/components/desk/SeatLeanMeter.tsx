import { useId, type CSSProperties } from "react";
import {
  DIRECTIONAL_LEAN_DISCLAIMER,
  DIRECTIONAL_LEAN_LABEL,
  DIRECTION_WORD,
  leanKey,
  leanValueText,
  researchReadWord,
  type SeatLean,
} from "@/lib/desk/seat-lean";
import { utcStamp } from "@/lib/desk/display-evidence";
import { cn } from "@/lib/utils";
import "./SeatLeanMeter.css";

/**
 * The Directional Lean instrument. A display of one seat's research read; it
 * decides nothing. The root element is keyed by the complete window identity
 * (ticker, close time) plus the seat, so a new window is a new element and the
 * marker never slides from a previous window's value.
 */
export function SeatLeanMeter({
  lean,
  mode = "pro",
  showDisclaimer = false,
  feedAgeS,
  className,
}: {
  lean: SeatLean;
  /** Guided prints Bullish / Neutral / Bearish and a plain status; Pro adds the number, the side, the card and the strength. */
  mode?: "guided" | "pro";
  /** Print the one-line disclaimer under the meter (the first occurrence on a page should). */
  showDisclaimer?: boolean;
  /** Seconds since the seat's feed last printed, when the caller has the vote. */
  feedAgeS?: number | null;
  className?: string;
}) {
  const id = useId();
  const empty = lean.score == null;
  const text = leanValueText(lean);
  const style = { "--lean-position": `${lean.score ?? 50}%` } as CSSProperties;
  const word = DIRECTION_WORD[lean.direction];
  const side = researchReadWord(lean);
  const key = leanKey(lean);
  return (
    <div key={key} className={cn("seat-lean", empty && "seat-lean--empty", className)} data-seat={lean.seat} data-window={lean.window.ticker} data-lean-key={key} style={style}>
      <div className="seat-lean__head">
        <span id={`${id}-label`} className="seat-lean__label">{DIRECTIONAL_LEAN_LABEL}</span>
        <span className="seat-lean__value" data-direction={lean.direction}>
          {mode === "pro" ? (empty ? `NO READ` : `${lean.score} · ${word}`) : word}
        </span>
      </div>
      <div
        className="seat-lean__axis"
        role={empty ? "img" : "meter"}
        aria-labelledby={`${id}-label`}
        aria-describedby={`${id}-text`}
        aria-valuemin={empty ? undefined : 0}
        aria-valuemax={empty ? undefined : 100}
        aria-valuenow={empty ? undefined : lean.score ?? undefined}
        aria-valuetext={text}
      >
        <span className="seat-lean__end" aria-hidden="true">Bearish</span>
        <div className="seat-lean__track" aria-hidden="true">
          <span className="seat-lean__center" />
          {empty ? null : <span className="seat-lean__marker" />}
        </div>
        <span className="seat-lean__end" aria-hidden="true">Bullish</span>
      </div>
      <div className="seat-lean__meta">
        {mode === "pro" ? <span>Research read: <span className="seat-lean__status">{side}</span></span> : null}
        {lean.stale ? <span className="seat-lean__stale">STALE</span> : null}
        <span>
          Status: <span className="seat-lean__status" data-authorized={lean.isAuthorizedSpeaker}>{mode === "pro" ? lean.status : lean.statusPlain}</span>
        </span>
        {mode === "pro" && lean.skillId ? <span>Card: {lean.skillId}</span> : null}
        {mode === "pro" && lean.sourceStrength != null ? <span>Strength: {lean.sourceStrength}</span> : null}
        <span>
          Updated: {utcStamp(lean.window.as_of)}
          {feedAgeS != null && Number.isFinite(feedAgeS) ? ` · feed ${feedAgeS.toFixed(1)}s` : ""}
        </span>
        {mode === "pro" && !lean.isAuthorizedSpeaker && lean.score != null && lean.direction !== "NEUTRAL" ? (
          <span className="seat-lean__reason">{lean.statusPlain}</span>
        ) : null}
        {lean.reason ? <span className="seat-lean__reason">{lean.reason}</span> : null}
      </div>
      <span id={`${id}-text`} className="sr-only">{text}</span>
      {showDisclaimer ? <p className="seat-lean__note">{DIRECTIONAL_LEAN_DISCLAIMER}</p> : null}
    </div>
  );
}

/**
 * A folded-row or table-cell form: the number and a short track, nothing else.
 * Inside an element that already carries the lean in its accessible name (a
 * labelled row button), pass `decorative` so this form is hidden from assistive
 * tech and the two never conflict.
 */
export function SeatLeanMini({ lean, className, decorative = false }: { lean: SeatLean; className?: string; decorative?: boolean }) {
  const empty = lean.score == null;
  const style = { "--lean-position": `${lean.score ?? 50}%` } as CSSProperties;
  const key = leanKey(lean);
  return (
    <span
      key={key}
      className={cn("seat-lean seat-lean--mini", empty && "seat-lean--empty", className)}
      style={style}
      data-lean-key={key}
      role={decorative ? undefined : "img"}
      aria-hidden={decorative ? true : undefined}
      aria-label={decorative ? undefined : leanValueText(lean)}
      title={`${DIRECTIONAL_LEAN_LABEL} · ${DIRECTIONAL_LEAN_DISCLAIMER}`}
    >
      <span className="seat-lean__value" data-direction={lean.direction} aria-hidden="true">{empty ? "—" : lean.score}</span>
      <span className="seat-lean__track" aria-hidden="true">
        <span className="seat-lean__center" />
        {empty ? null : <span className="seat-lean__marker" />}
      </span>
    </span>
  );
}
