import { useEffect, useId, useMemo, useState } from "react";
import type { Arena, ArenaRow } from "@/lib/desk/arena";
import { useCountdownText, useTickingAge } from "@/lib/desk/hooks";
import { pulseSkewMs } from "@/lib/desk/pulse";
import { streamMillis, streamPoints } from "@/lib/atelier/streamer";
import type { SatoshiPaint } from "./gallery";
import { CouncilVoiceButton } from "@/components/desk/CouncilVoiceButton";
import "./streamer.css";

const CONCEPT = "/atelier/streamer-concept.png";
const money = (value: number) =>
  Number.isFinite(value) && value > 0
    ? value.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 2,
      })
    : "—";

function Spotlight({
  seat,
  satoshi,
  fresh,
}: {
  seat: "WICK" | "DRIFT";
  satoshi: SatoshiPaint;
  fresh: boolean;
}) {
  const vote = satoshi.votes.find((candidate) => candidate.seat === seat);
  return (
    <article className="streamer-seat" data-seat={seat} data-lean={vote?.lean ?? "WAIT"}>
      <div className="streamer-portrait" aria-hidden="true">
        <img src={CONCEPT} alt="" width="1672" height="941" />
      </div>
      <div className="streamer-seat-copy">
        <span className="streamer-eyebrow">
          {fresh ? "Specialist spotlight" : "Last known read"}
        </span>
        <h3>{seat}</h3>
        <strong className="streamer-lean">{vote?.lean ?? "—"}</strong>
        <p>{vote?.reasoning || "Waiting for this seat’s next reading."}</p>
        {fresh && satoshi.source === "live" ? (
          <CouncilVoiceButton source="live" speaker={seat} label={"Hear " + seat} className="streamer-voice" />
        ) : null}
      </div>
    </article>
  );
}

function WindowChart({ satoshi, fresh }: { satoshi: SatoshiPaint; fresh: boolean }) {
  const gradient = useId();
  const points = useMemo(() => streamPoints(satoshi, fresh), [satoshi, fresh]);
  const strike = Number.isFinite(satoshi.strike) && satoshi.strike > 0 ? satoshi.strike : null;
  const values = [...points.map((point) => point.price), ...(strike == null ? [] : [strike])];
  const lo = values.length ? Math.min(...values) : 0;
  const hi = values.length ? Math.max(...values) : 1;
  const padding = Math.max(5, (hi - lo) * 0.18);
  const y = (price: number) => 220 - ((price - lo + padding) / (hi - lo + padding * 2)) * 184;
  const x = (progress: number) => 14 + progress * 732;
  const path = points
    .map(
      (point, index) =>
        `${index ? "L" : "M"}${x(point.progress).toFixed(2)},${y(point.price).toFixed(2)}`,
    )
    .join(" ");
  const last = points.at(-1);
  const fill =
    points.length > 1 && last
      ? `${path} L${x(last.progress)},238 L${x(points[0]!.progress)},238 Z`
      : "";
  return (
    <div className="streamer-chart">
      <div className="streamer-price-row">
        <div>
          <span className="streamer-eyebrow">Bitcoin spot</span>
          <strong>{money(satoshi.spot)}</strong>
        </div>
        <div>
          <span className="streamer-eyebrow">Window target</span>
          <b>{money(satoshi.strike)}</b>
        </div>
      </div>
      <svg
        viewBox="0 0 760 270"
        role="img"
        aria-label={`Bitcoin spot during the current 15-minute window. Target ${money(satoshi.strike)}. Spot is not the official settlement.`}
      >
        <defs>
          <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#e9b961" stopOpacity=".28" />
            <stop offset="100%" stopColor="#e9b961" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[40, 88, 136, 184, 232].map((line) => (
          <line key={line} x1="14" x2="746" y1={line} y2={line} className="streamer-gridline" />
        ))}
        {[0, 0.25, 0.5, 0.75, 1].map((progress) => (
          <line
            key={progress}
            x1={x(progress)}
            x2={x(progress)}
            y1="24"
            y2="238"
            className="streamer-gridline"
          />
        ))}
        {strike != null && (
          <>
            <line x1="14" x2="746" y1={y(strike)} y2={y(strike)} className="streamer-target" />
            <text x="20" y={Math.max(18, y(strike) - 9)} className="streamer-target-label">
              WINDOW TARGET
            </text>
          </>
        )}
        {fill && <path d={fill} fill={`url(#${gradient})`} />}
        {points.length > 1 && <path d={path} className="streamer-trace" />}
        {last && <circle cx={x(last.progress)} cy={y(last.price)} r="4" fill="#ffe1a3" />}
        {!points.length && (
          <text x="380" y="132" textAnchor="middle" className="streamer-chart-empty">
            Waiting for this window’s price history
          </text>
        )}
        {["OPEN", "5 MIN", "10 MIN", "CLOSE"].map((label, index) => (
          <text
            key={label}
            x={x(index / 3)}
            y="262"
            textAnchor={index === 0 ? "start" : index === 3 ? "end" : "middle"}
            className="streamer-axis"
          >
            {label}
          </text>
        ))}
      </svg>
      <div className="streamer-chart-note">
        <span>Spot trace · official settlement uses the final-minute average</span>
        {satoshi.locked > 0 && satoshi.settleAvg != null && (
          <span>Observed average {money(satoshi.settleAvg)}</span>
        )}
      </div>
    </div>
  );
}

function AudienceBoard({ enabled }: { enabled: boolean }) {
  const [rows, setRows] = useState<ArenaRow[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let controller: AbortController | null = null;
    const pull = async () => {
      controller?.abort();
      controller = new AbortController();
      try {
        // Public, anonymous summary only. No device token or paper-call submission.
        const response = await fetch("/arena/summary", {
          headers: { accept: "application/json" },
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]),
        });
        if (!response.ok) throw new Error("Board unavailable");
        const board = (await response.json()) as Arena;
        if (!Array.isArray(board.week)) throw new Error("Board unavailable");
        if (alive) {
          setRows(board.week.filter((row) => !row.warming && row.n > 0).slice(0, 3));
          setError(false);
        }
      } catch {
        if (alive) setError(true);
      }
    };
    void pull();
    const timer = window.setInterval(() => {
      if (!document.hidden) void pull();
    }, 60_000);
    return () => {
      alive = false;
      controller?.abort();
      window.clearInterval(timer);
    };
  }, [enabled]);
  return (
    <section className="streamer-board" aria-label="Audience leaderboard this week">
      <div>
        <span className="streamer-eyebrow">Audience · this week</span>
        <h3>On the board</h3>
      </div>
      {!enabled ? (
        <p>Audience records appear with the live feed.</p>
      ) : error ? (
        <p>Leaderboard temporarily unavailable.</p>
      ) : rows == null ? (
        <p>Loading audience records…</p>
      ) : !rows.length ? (
        <p>No graded audience calls yet. Yours could be first.</p>
      ) : (
        <table>
          <caption>Arena order · correct / graded paper calls</caption>
          <thead className="sr-only">
            <tr>
              <th>Callsign</th>
              <th>Correct / graded</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.name}>
                <th scope="row">{row.name}</th>
                <td>
                  {row.wins} / {row.n}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export function Streamer({ satoshi, concept }: { satoshi: SatoshiPaint; concept: boolean }) {
  const countdown = useCountdownText(streamMillis(satoshi.closeTime));
  const ageText = useTickingAge(0, streamMillis(satoshi.asOf) - pulseSkewMs());
  const age = Number.parseFloat(ageText);
  const live = satoshi.source === "live";
  const fresh =
    !live ||
    (satoshi.asOf > 0 &&
      satoshi.brainAge != null &&
      Math.max(age, satoshi.brainAge) < 20 &&
      age + satoshi.spotAge < 20);
  const counts = { UP: 0, DOWN: 0, WAIT: 0 };
  for (const vote of satoshi.votes) counts[vote.lean] += 1;
  const total = satoshi.votes.length;
  const tape = satoshi.votes.find((vote) => vote.seat === "TAPE");
  const closed = satoshi.closeTime > 0 && (countdown === "0:00" || countdown === "00:00");

  if (concept)
    return (
      <figure className="streamer-concept">
        <img
          src={CONCEPT}
          alt="Council Live concept: Wick and Drift flank a Bitcoin chart, with a countdown and sample audience leaderboard. All numbers and calls in this artwork are illustrative."
          width="1672"
          height="941"
        />
        <figcaption>
          Concept preview · sample data. Use the image button to return to the current feed.
        </figcaption>
      </figure>
    );

  return (
    <section className="streamer" aria-label="Streamer — Council Live" data-fresh={fresh}>
      <header className="streamer-header">
        <div className="streamer-brand">
          <img src="/seal-figure.png" alt="" width="46" height="46" />
          <span>SATOSHI’S COUNCIL</span>
        </div>
        <div className="streamer-show">
          COUNCIL <span>LIVE</span>
        </div>
        <span className="streamer-feed" data-live={live && fresh}>
          {!live ? "DEMO FEED" : fresh ? "LIVE FEED" : "FEED DELAYED"}
        </span>
      </header>
      <div className="streamer-title">
        <span className="streamer-rule" />
        <h2>Can you beat the bots?</h2>
        <span className="streamer-rule" />
      </div>
      <div className="streamer-main">
        <Spotlight seat="WICK" satoshi={satoshi} fresh={fresh} />
        <div className="streamer-center">
          <div className="streamer-round">
            <div className="streamer-chair" data-lean={satoshi.lean}>
              <img src="/seal-figure.png" alt="" width="48" height="48" />
              <div>
                <span className="streamer-eyebrow">
                  {fresh ? "Chair’s published call" : "Chair · last known call"}
                </span>
                <strong>{satoshi.asOf > 0 ? satoshi.lean : "—"}</strong>
                <small>
                  Score {Number.isFinite(satoshi.score) ? Math.abs(satoshi.score).toFixed(2) : "—"}{" "}
                  / bar {Number.isFinite(satoshi.bar) ? satoshi.bar.toFixed(2) : "—"}
                </small>
                {fresh && live ? (
                  <CouncilVoiceButton source="live" speaker="SATOSHI" label="Hear SATOSHI" className="streamer-voice" />
                ) : null}
              </div>
            </div>
            <div className="streamer-clock">
              <span className="streamer-eyebrow">
                {closed ? "Window closed" : "Window closes in"}
              </span>
              <time>{satoshi.closeTime > 0 ? countdown : "—"}</time>
            </div>
          </div>
          {!fresh && (
            <p className="streamer-delay" role="status">
              The feed is delayed. Showing the last received readings.
            </p>
          )}
          <WindowChart satoshi={satoshi} fresh={fresh} />
          <div className="streamer-votes">
            <div className="streamer-votes-label">
              <span className="streamer-eyebrow">Seat readings · {total} stations</span>
              <span>All stations · not the Chair’s voting quorum</span>
            </div>
            <div className="streamer-vote-bar" aria-hidden="true">
              {(["UP", "WAIT", "DOWN"] as const).map((lean) => (
                <span key={lean} data-lean={lean} style={{ flex: counts[lean] }} />
              ))}
            </div>
            <div className="streamer-vote-counts">
              {(["UP", "WAIT", "DOWN"] as const).map((lean) => (
                <span key={lean} data-lean={lean}>
                  {lean} <b>{counts[lean]}</b>
                </span>
              ))}
            </div>
          </div>
          <div className="streamer-tape" data-lean={tape?.lean ?? "WAIT"}>
            <div>
              <span className="streamer-eyebrow">Third mic · order book</span>
              <strong>TAPE · {tape?.lean ?? "—"}</strong>
              <p>{tape?.reasoning || "Waiting for TAPE’s next fresh book read."}</p>
            </div>
            {fresh && live ? (
              <CouncilVoiceButton source="live" speaker="TAPE" label="Hear TAPE" className="streamer-voice" />
            ) : null}
          </div>
        </div>
        <Spotlight seat="DRIFT" satoshi={satoshi} fresh={fresh} />
      </div>
      <div className="streamer-bottom">
        <AudienceBoard enabled={live} />
        <a className="streamer-join" href="/?tab=satoshi">
          <span>Pick a callsign. Make your paper call.</span>
          <strong>satoshiscouncil.com</strong>
          <span>
            Join the next window <span aria-hidden="true">↗</span>
          </span>
        </a>
      </div>
      <footer className="streamer-footer">
        <span title={satoshi.ticker}>{satoshi.ticker || "Waiting for the next window"}</span>
        <span>
          {satoshi.lastSettled && satoshi.lastSettledAt > 0
            ? `Last official: ${satoshi.lastSettled} · ${new Date(streamMillis(satoshi.lastSettledAt)).toISOString().slice(11, 16)} UTC`
            : "Awaiting an official result"}
        </span>
        <span>AI-generated character voices · optional</span>
        <span>Paper only · no real money</span>
      </footer>
    </section>
  );
}
