import { useEffect, useState } from "react";
import { fetchReplay, type Replay } from "@/lib/desk/replay";
import { cn } from "@/lib/utils";
import { LeanChip, Pane } from "./bits";
import { Tip } from "./Tip";
import { BG, DOWN, FG, FONT_SM, GRID, INK, LINE, UP, WAIT, fillRound, useDraw } from "./canvas";

const WINDOW_S = 900;
const DOMAIN_S = WINDOW_S + 20;
const PAD_L = 50;
const PAD_R = 46;

function secsFromOpen(r: Replay, i: number): number {
  const closeMs = Date.parse(r.close_time);
  return (r.cols.t0 + (r.cols.t[i] ?? 0) * 1000 - (closeMs - WINDOW_S * 1000)) / 1000;
}

function xScale(w: number) {
  const inner = w - PAD_L - PAD_R;
  return (s: number) => PAD_L + (Math.max(0, Math.min(DOMAIN_S, s)) / DOMAIN_S) * inner;
}

function fmtPx(v: number | null | undefined, d = 2): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

function fmtC(n: number | null | undefined, d = 1): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n > 0 ? "+" : ""}${n.toFixed(d)}¢`;
}

function fmtWhen(iso: string, tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function fmtLeft(secs: number): string {
  const s = Math.max(0, Math.round(secs));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function cursorLine(ctx: CanvasRenderingContext2D, x: number, top: number, bottom: number) {
  ctx.save();
  ctx.strokeStyle = LINE;
  ctx.globalAlpha = 0.8;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, top);
  ctx.lineTo(x, bottom);
  ctx.stroke();
  ctx.restore();
}

function drawPrice(ctx: CanvasRenderingContext2D, w: number, h: number, r: Replay, cursor: number) {
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, w, h);
  const x = xScale(w);
  const plotT = 10;
  const plotB = h - 16;
  const c = r.cols;
  const strike = r.strike ?? 0;
  const vals = c.spot.filter((v) => Number.isFinite(v));
  if (!vals.length) return;
  const hi0 = Math.max(...vals, strike || -Infinity);
  const lo0 = Math.min(...vals, strike || Infinity);
  const pad = Math.max(2, (hi0 - lo0) * 0.12);
  const hi = hi0 + pad;
  const lo = lo0 - pad;
  const y = (v: number) => plotT + ((hi - v) / (hi - lo)) * (plotB - plotT);
  const xs = c.t.map((_, i) => x(secsFromOpen(r, i)));

  // final minute
  ctx.fillStyle = GRID;
  ctx.globalAlpha = 0.55;
  ctx.fillRect(x(WINDOW_S - 60), plotT, x(WINDOW_S) - x(WINDOW_S - 60), plotB - plotT);
  ctx.globalAlpha = 1;
  // grid + clock labels
  ctx.strokeStyle = GRID;
  ctx.lineWidth = 1;
  ctx.font = FONT_SM;
  ctx.fillStyle = FG;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (const [s, label] of [[0, "open"], [300, "10:00 left"], [600, "5:00 left"], [WINDOW_S, "close"]] as [number, string][]) {
    ctx.beginPath();
    ctx.moveTo(x(s), plotT);
    ctx.lineTo(x(s), plotB);
    ctx.stroke();
    ctx.fillText(label, x(s), plotB + 3);
  }
  if (strike > 0) {
    const area = (above: boolean) => {
      ctx.save();
      ctx.beginPath();
      if (above) ctx.rect(0, plotT - 2, w, Math.max(0, y(strike) - plotT + 2));
      else ctx.rect(0, y(strike), w, Math.max(0, plotB - y(strike) + 2));
      ctx.clip();
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = above ? UP : DOWN;
      ctx.beginPath();
      ctx.moveTo(xs[0], y(strike));
      c.spot.forEach((v, i) => ctx.lineTo(xs[i], y(v)));
      ctx.lineTo(xs[xs.length - 1], y(strike));
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    };
    area(true);
    area(false);
    ctx.strokeStyle = WAIT;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(PAD_L, y(strike));
    ctx.lineTo(w - PAD_R, y(strike));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = WAIT;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(fmtPx(strike, 0), w - PAD_R + 4, y(strike));
  }
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  c.spot.forEach((v, i) => (i ? ctx.lineTo(xs[i], y(v)) : ctx.moveTo(xs[i], y(v))));
  ctx.stroke();
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillStyle = LINE;
  ctx.fillText("btc", PAD_L + 4, 1);
  ctx.fillStyle = WAIT;
  ctx.fillText("strike", PAD_L + 26, 1);
  ctx.fillStyle = FG;
  ctx.fillText("final minute", x(WINDOW_S - 60) + 3, 1);
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  if (Math.abs(y(hi0) - (strike > 0 ? y(strike) : -99)) > 9) ctx.fillText(fmtPx(hi0, 0), w - PAD_R + 4, y(hi0));
  if (Math.abs(y(lo0) - (strike > 0 ? y(strike) : -99)) > 9) ctx.fillText(fmtPx(lo0, 0), w - PAD_R + 4, y(lo0));
  // cursor
  const cx = xs[cursor] ?? xs[xs.length - 1];
  cursorLine(ctx, cx, plotT, plotB);
  const cv = c.spot[cursor];
  if (Number.isFinite(cv)) {
    ctx.fillStyle = cv >= strike && strike > 0 ? UP : strike > 0 ? DOWN : LINE;
    ctx.beginPath();
    ctx.arc(cx, y(cv), 3, 0, Math.PI * 2);
    ctx.fill();
    const text = fmtPx(cv, 2);
    ctx.font = FONT_SM;
    const tw = ctx.measureText(text).width + 8;
    const px = Math.min(w - PAD_R - tw - 2, Math.max(PAD_L, cx + 6));
    const py = Math.max(plotT, Math.min(y(cv) - 16, plotB - 14));
    ctx.fillStyle = LINE;
    fillRound(ctx, px, py, tw, 14, 2);
    ctx.fillStyle = INK;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, px + tw / 2, py + 7);
  }
}

function drawMind(ctx: CanvasRenderingContext2D, w: number, h: number, r: Replay, cursor: number) {
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, w, h);
  const x = xScale(w);
  const c = r.cols;
  const bandH = 9;
  const plotT = 12;
  const plotB = h - bandH - 8;
  const y = (v: number) => plotT + (1 - Math.max(0, Math.min(100, v)) / 100) * (plotB - plotT);
  const xs = c.t.map((_, i) => x(secsFromOpen(r, i)));
  ctx.strokeStyle = GRID;
  ctx.lineWidth = 1;
  ctx.font = FONT_SM;
  ctx.fillStyle = FG;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  for (const g of [25, 50, 75]) {
    ctx.beginPath();
    ctx.moveTo(PAD_L, y(g));
    ctx.lineTo(w - PAD_R, y(g));
    ctx.stroke();
    ctx.fillText(`${g}¢`, w - PAD_R + 4, y(g));
  }
  // fair (lab), with gaps where the lab had none
  ctx.strokeStyle = WAIT;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  let pen = false;
  c.fair.forEach((v, i) => {
    if (v == null) {
      pen = false;
      return;
    }
    if (pen) ctx.lineTo(xs[i], y(v));
    else ctx.moveTo(xs[i], y(v));
    pen = true;
  });
  ctx.stroke();
  // yes ask
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  c.yes_ask.forEach((v, i) => (i ? ctx.lineTo(xs[i], y(v)) : ctx.moveTo(xs[i], y(v))));
  ctx.stroke();
  // legend
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillStyle = LINE;
  ctx.fillText("yes ask", PAD_L, 1);
  ctx.fillStyle = WAIT;
  ctx.fillText("lab fair", PAD_L + 46, 1);
  ctx.fillStyle = FG;
  ctx.fillText("chair ▼", PAD_L + 98, 1);
  // chair band
  const bandT = plotB + 4;
  for (let i = 0; i < xs.length; i++) {
    const x0 = xs[i];
    const x1 = i + 1 < xs.length ? xs[i + 1] : x0 + 3;
    const lean = c.lean[i];
    if (!lean) {
      ctx.fillStyle = GRID;
      ctx.globalAlpha = 1;
    } else {
      ctx.fillStyle = lean > 0 ? UP : DOWN;
      ctx.globalAlpha = 0.35 + 0.65 * Math.max(0, Math.min(1, ((c.conf[i] ?? 50) - 50) / 40));
    }
    ctx.fillRect(x0, bandT, Math.max(1, x1 - x0), bandH);
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = FG;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("chair", w - PAD_R + 4, bandT + bandH / 2);
  // booked marker
  const b = c.booked.findIndex((v) => v === 1);
  if (b >= 0) {
    ctx.fillStyle = LINE;
    ctx.beginPath();
    ctx.moveTo(xs[b], bandT - 1);
    ctx.lineTo(xs[b] - 4, bandT - 7);
    ctx.lineTo(xs[b] + 4, bandT - 7);
    ctx.closePath();
    ctx.fill();
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText("booked", xs[b] + 6, bandT - 1);
  }
  cursorLine(ctx, xs[cursor] ?? xs[xs.length - 1], plotT, bandT + bandH);
}

function drawLanes(ctx: CanvasRenderingContext2D, w: number, h: number, r: Replay, cursor: number) {
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, w, h);
  const x = xScale(w);
  const c = r.cols;
  const ids = Object.keys(c.seats);
  if (!ids.length) return;
  const rowH = (h - 4) / ids.length;
  const xs = c.t.map((_, i) => x(secsFromOpen(r, i)));
  ctx.font = FONT_SM;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ids.forEach((id, row) => {
    const top = 2 + row * rowH;
    ctx.fillStyle = FG;
    ctx.fillText(id, PAD_L - 4, top + rowH / 2);
    ctx.strokeStyle = GRID;
    ctx.beginPath();
    ctx.moveTo(PAD_L, top + rowH);
    ctx.lineTo(w - PAD_R, top + rowH);
    ctx.stroke();
    const lane = c.seats[id] ?? [];
    for (let i = 0; i < xs.length; i++) {
      const v = lane[i] ?? 0;
      if (!v) continue;
      const x0 = xs[i];
      const x1 = i + 1 < xs.length ? xs[i + 1] : x0 + 3;
      ctx.fillStyle = v > 0 ? UP : DOWN;
      ctx.globalAlpha = Math.abs(v) >= 2 ? 0.95 : 0.3;
      ctx.fillRect(x0, top + 1, Math.max(1, x1 - x0), Math.max(1, rowH - 2));
    }
    ctx.globalAlpha = 1;
  });
  cursorLine(ctx, xs[cursor] ?? xs[xs.length - 1], 2, h - 2);
}

function PriceChart({ r, cursor }: { r: Replay; cursor: number }) {
  const ref = useDraw((ctx, w, h) => drawPrice(ctx, w, h, r, cursor), `${r.ticker}:${cursor}`);
  return <canvas ref={ref} className="block h-44 w-full rounded-sm" />;
}
function MindChart({ r, cursor }: { r: Replay; cursor: number }) {
  const ref = useDraw((ctx, w, h) => drawMind(ctx, w, h, r, cursor), `${r.ticker}:${cursor}`);
  return <canvas ref={ref} className="block h-36 w-full rounded-sm" />;
}
function Lanes({ r, cursor }: { r: Replay; cursor: number }) {
  const ref = useDraw((ctx, w, h) => drawLanes(ctx, w, h, r, cursor), `${r.ticker}:${cursor}`);
  const rows = Object.keys(r.cols.seats).length || 1;
  return <canvas ref={ref} className="block w-full rounded-sm" style={{ height: `${rows * 9 + 4}px` }} />;
}

/** onClose is the in-desk close button; without it the pane stands alone on its own page. */
export function ReplayPane({ ticker, tz, onClose }: { ticker: string; tz: string; onClose?: () => void }) {
  const pageHref = `/window/${encodeURIComponent(ticker)}`;
  const [r, setR] = useState<Replay | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    let alive = true;
    setR(null);
    setErr(null);
    setPlaying(false);
    fetchReplay(ticker)
      .then((rep) => {
        if (!alive) return;
        setR(rep);
        setCursor(Math.max(0, rep.cols.t.length - 1));
      })
      .catch((e) => alive && setErr(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [ticker]);

  useEffect(() => {
    if (!playing || !r) return;
    const n = r.cols.t.length;
    const id = setInterval(() => {
      setCursor((cur) => {
        if (cur + 1 >= n) {
          setPlaying(false);
          return cur;
        }
        return cur + 1;
      });
    }, 110);
    return () => clearInterval(id);
  }, [playing, r]);

  const title = (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Tip k="books.replay">REPLAY</Tip>
      <span className="font-normal text-muted">{r ? fmtWhen(r.close_time, tz) : ticker}</span>
    </span>
  );

  if (!r) {
    return (
      <Pane title={title}>
        <div className="flex items-center justify-between font-mono text-micro text-muted">
          <span>{err ? `no replay: ${err}` : "rewinding…"}</span>
          {onClose ? (
            <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
              close
            </button>
          ) : null}
        </div>
      </Pane>
    );
  }

  const c = r.cols;
  const n = c.t.length;
  const i = Math.max(0, Math.min(n - 1, cursor));
  const closeMs = Date.parse(r.close_time);
  const left = (closeMs - (c.t0 + (c.t[i] ?? 0) * 1000)) / 1000;
  const spot = c.spot[i];
  const dist = r.strike ? spot - r.strike : null;
  const lean = c.lean[i] > 0 ? "UP" : c.lean[i] < 0 ? "DOWN" : "WAIT";
  const speaking = Object.entries(c.seats)
    .filter(([, lane]) => Math.abs(lane[i] ?? 0) >= 2)
    .map(([id, lane]) => ({ id, up: (lane[i] ?? 0) > 0 }));
  const whispers = Object.values(c.seats).filter((lane) => Math.abs(lane[i] ?? 0) === 1).length;

  return (
    <Pane title={title}>
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-micro text-muted">
        {r.winner ? <LeanChip lean={r.winner} /> : null}
        <span>strike {fmtPx(r.strike)}</span>
        <span>settled {fmtPx(r.official)}</span>
        {r.call ? (
          <span className={cn("tabular", r.call.ev == null ? "text-muted" : r.call.ev > 0 ? "text-up" : r.call.ev < 0 ? "text-down" : "text-muted")}>
            chair booked {r.call.entry.toFixed(0)}¢ → {r.call.settle == null ? "open" : `${r.call.settle.toFixed(0)}¢`} · {fmtC(r.call.ev)}
          </span>
        ) : (
          <span className="text-subtle">chair sat out</span>
        )}
        {r.partial ? <span className="text-wait">partial: the recorder joined this window late</span> : null}
        {onClose ? (
          <>
            <a href={pageHref} target="_blank" rel="noopener" className="btn btn-secondary btn-sm ml-auto">
              open as a page ↗
            </a>
            <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
              close
            </button>
          </>
        ) : null}
      </div>
      <PriceChart r={r} cursor={i} />
      <div className="mt-1">
        <MindChart r={r} cursor={i} />
      </div>
      <div className="mt-1">
        <Lanes r={r} cursor={i} />
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-micro text-subtle" aria-label="Lane legend">
          <span>
            <span aria-hidden="true" className="mr-1 inline-block size-2 rounded-sm bg-up align-middle" />
            spoke UP
          </span>
          <span>
            <span aria-hidden="true" className="mr-1 inline-block size-2 rounded-sm bg-down align-middle" />
            spoke DOWN
          </span>
          <span>
            <span aria-hidden="true" className="mr-1 inline-block size-2 rounded-sm bg-up/30 align-middle" />
            whispered under the gag
          </span>
          <span>blank sat</span>
        </div>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => {
            if (!playing && i >= n - 1) setCursor(0);
            setPlaying((p) => !p);
          }}
        >
          {playing ? "pause" : i >= n - 1 ? "replay" : "play"}
        </button>
        <input
          type="range"
          min={0}
          max={Math.max(0, n - 1)}
          value={i}
          onChange={(e) => {
            setPlaying(false);
            setCursor(Number(e.target.value));
          }}
          className="w-full accent-gold"
          aria-label="scrub the window"
        />
      </div>
      <div className="mt-2 grid gap-x-4 gap-y-1 font-mono text-micro text-muted sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <span className="text-subtle">clock</span> {fmtLeft(left)} left
        </div>
        <div>
          <span className="text-subtle">btc</span> <span className="text-fg">{fmtPx(spot)}</span>{" "}
          {dist != null ? <span className={dist >= 0 ? "text-up" : "text-down"}>{dist >= 0 ? "+" : ""}{dist.toFixed(2)} vs strike</span> : null}
        </div>
        <div>
          <span className="text-subtle">yes</span> {c.yes_bid[i]?.toFixed(1)} / <span className="text-fg">{c.yes_ask[i]?.toFixed(1)}¢</span>{" "}
          <span className="text-subtle">fair</span> <span className="text-wait">{c.fair[i] == null ? "—" : `${c.fair[i]?.toFixed(1)}¢`}</span>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-subtle">chair</span> <LeanChip lean={lean} /> {lean !== "WAIT" ? <span>{c.conf[i]}</span> : null}
          <span className="text-subtle">· floor</span> <span className="text-up">{c.ups[i]} UP</span> <span className="text-down">{c.downs[i]} DOWN</span>
        </div>
        <div className="sm:col-span-2 lg:col-span-4">
          <span className="text-subtle">speaking</span>{" "}
          {speaking.length ? (
            speaking.map((s) => (
              <span key={s.id} className={cn("mr-1", s.up ? "text-up" : "text-down")}>
                {s.id}
              </span>
            ))
          ) : (
            <span>nobody</span>
          )}
          {whispers ? <span className="text-subtle"> · {whispers} whispering under the gag</span> : null}
          {c.booked[i] ? <span className="text-subtle"> · call on the book</span> : null}
        </div>
      </div>
    </Pane>
  );
}
