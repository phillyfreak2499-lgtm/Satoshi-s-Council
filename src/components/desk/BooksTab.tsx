import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  fetchBooks,
  type BooksLab,
  type Books,
  type BooksBucket,
  type BooksDay,
  type BooksHeatCell,
  type BooksPoint,
  type BooksTotals,
  type FloorTrial,
  type BooksWindow,
  type Keeper,
  type KeeperStats,
} from "@/lib/desk/books";
import { FLOOR_LIVE_CENTS, FLOOR_SHADOW_CENTS } from "@/lib/desk/book-floor";
import { cn } from "@/lib/utils";
import { LeanChip, Pane } from "./bits";
import { Tip } from "./Tip";
import { ReplayPane } from "./ReplayPane";
import { BG, DOWN, FG, FONT_SM, GRID, INK, LINE, UP, WAIT, fillRound, useDraw } from "./canvas";

function fmtC(n: number | null | undefined, d = 1): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n > 0 ? "+" : ""}${n.toFixed(d)}¢`;
}

function tone(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n === 0) return "text-muted";
  return n > 0 ? "text-up" : "text-down";
}

function fmtWhen(iso: string, tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
  } catch {
    return iso.slice(11, 16);
  }
}

function fmtDay(iso: string, tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric" }).format(new Date(iso));
  } catch {
    return iso.slice(5, 10);
  }
}

function fmtPx(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function pct(a: number, b: number): string {
  return b ? `${Math.round((100 * a) / b)}%` : "—";
}

/* ---------- charts ---------- */

function drawCurve(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  pts: BooksPoint[],
  days: BooksDay[],
  tz: string,
  since: string,
  trialSince: string | null,
) {
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, w, h);
  const padL = 8;
  const padR = 48;
  const padT = 12;
  const stripH = 24;
  const plotT = padT;
  const plotB = h - 16 - stripH;
  ctx.font = FONT_SM;
  ctx.fillStyle = FG;
  if (!pts.length) {
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("no booked windows in the last fourteen days", w / 2, h / 2);
    return;
  }
  const vals = pts.map((p) => p.cum);
  const hi0 = Math.max(0, ...vals);
  const lo0 = Math.min(0, ...vals);
  const span0 = Math.max(10, hi0 - lo0);
  const pad = span0 * 0.1;
  const hi = hi0 + pad;
  const lo = lo0 - pad;
  const span = hi - lo;
  const y = (v: number) => plotT + ((hi - v) / span) * (plotB - plotT);
  const innerW = w - padL - padR;
  const x = (i: number) => padL + (pts.length === 1 ? innerW / 2 : (i / (pts.length - 1)) * innerW);
  const y0 = y(0);

  // grid
  ctx.strokeStyle = GRID;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 1; i < 4; i++) {
    const yy = plotT + ((plotB - plotT) * i) / 4;
    ctx.moveTo(padL, yy);
    ctx.lineTo(w - padR, yy);
  }
  ctx.stroke();
  // zero line
  ctx.strokeStyle = FG;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(padL, y0);
  ctx.lineTo(w - padR, y0);
  ctx.stroke();
  ctx.setLineDash([]);

  const area = () => {
    ctx.beginPath();
    ctx.moveTo(x(0), y0);
    pts.forEach((p, i) => ctx.lineTo(x(i), y(p.cum)));
    ctx.lineTo(x(pts.length - 1), y0);
    ctx.closePath();
  };
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, plotT - 2, w, Math.max(0, y0 - plotT + 2));
  ctx.clip();
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = UP;
  area();
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, y0, w, Math.max(0, plotB - y0 + 2));
  ctx.clip();
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = DOWN;
  area();
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = LINE;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(x(i), y(p.cum)) : ctx.moveTo(x(i), y(p.cum))));
  ctx.stroke();

  // right-hand scale
  ctx.fillStyle = FG;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  if (hi0 > 0 && y0 - y(hi0) > 9) ctx.fillText(fmtC(hi0, 0), w - padR + 4, y(hi0));
  if (lo0 < 0 && y(lo0) - y0 > 9) ctx.fillText(fmtC(lo0, 0), w - padR + 4, y(lo0));
  ctx.fillText("0", w - padR + 4, y0);

  // day ticks
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  let lastLabelX = -1e9;
  let lastDay = "";
  pts.forEach((p, i) => {
    const d = fmtDay(p.t, tz);
    if (d === lastDay) return;
    lastDay = d;
    const xx = x(i);
    if (xx - lastLabelX < 46) return;
    lastLabelX = xx;
    ctx.strokeStyle = GRID;
    ctx.beginPath();
    ctx.moveTo(xx, plotT);
    ctx.lineTo(xx, plotB);
    ctx.stroke();
    ctx.fillStyle = FG;
    ctx.fillText(d, xx, plotB + 2);
  });

  // Both floor boundaries, where they fall in view: the curve should say which
  // rule the book was playing at any point on it, not only the older one.
  const mark = (at: string, label: string) => {
    const i = pts.findIndex((p) => p.t >= at);
    if (i <= 0) return;
    const xx = (x(i - 1) + x(i)) / 2;
    ctx.strokeStyle = WAIT;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(xx, plotT);
    ctx.lineTo(xx, plotB);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = WAIT;
    ctx.font = FONT_SM;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(label, xx + 3, plotT);
  };
  mark(since, `${FLOOR_SHADOW_CENTS}¢ floor`);
  if (trialSince) mark(trialSince, `${FLOOR_LIVE_CENTS}¢ floor`);

  // last pill
  const last = pts[pts.length - 1];
  const text = fmtC(last.cum);
  const color = last.cum > 0 ? UP : last.cum < 0 ? DOWN : FG;
  ctx.font = FONT_SM;
  const tw = ctx.measureText(text).width + 8;
  const px = w - tw - 3;
  const py = Math.max(2, Math.min(y(last.cum) - 7, plotB - 14));
  ctx.fillStyle = color;
  fillRound(ctx, px, py, tw, 14, 2);
  ctx.fillStyle = INK;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, px + tw / 2, py + 7);

  // day strip: each day's net
  const stripT = h - stripH - 2;
  const stripB = h - 2;
  const mid = (stripT + stripB) / 2;
  ctx.strokeStyle = GRID;
  ctx.beginPath();
  ctx.moveTo(padL, mid);
  ctx.lineTo(w - padR, mid);
  ctx.stroke();
  if (days.length) {
    const maxAbs = Math.max(1, ...days.map((d) => Math.abs(d.net)));
    const dw = innerW / days.length;
    days.forEach((d, i) => {
      const bh = ((stripB - stripT) / 2 - 1) * (Math.abs(d.net) / maxAbs);
      const bx = padL + i * dw + dw * 0.15;
      const bw = Math.max(2, dw * 0.7);
      ctx.fillStyle = d.net > 0 ? UP : d.net < 0 ? DOWN : GRID;
      if (d.net >= 0) fillRound(ctx, bx, mid - bh, bw, Math.max(1, bh), 1);
      else fillRound(ctx, bx, mid, bw, Math.max(1, bh), 1);
    });
  }
  ctx.fillStyle = FG;
  ctx.font = FONT_SM;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("day", w - padR + 4, mid);
}

function bucketLabel(b: BooksBucket): string {
  if (b.lo === 0) return "<50¢";
  if (b.hi >= 100) return "90¢+";
  return `${b.lo}–${b.hi}¢`;
}

function drawBuckets(ctx: CanvasRenderingContext2D, w: number, h: number, buckets: BooksBucket[]) {
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, w, h);
  ctx.font = FONT_SM;
  ctx.fillStyle = FG;
  if (!buckets.length) {
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("no booked calls yet", w / 2, h / 2);
    return;
  }
  const padL = 34;
  const padR = 8;
  const padT = 8;
  const padB = 38; // three lines under the axis: the shelf, how often it won, what it needed
  const plotT = padT;
  const plotB = h - padB;
  const y = (v: number) => plotB - (Math.max(0, Math.min(100, v)) / 100) * (plotB - plotT);
  ctx.strokeStyle = GRID;
  ctx.lineWidth = 1;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (const g of [25, 50, 75, 100]) {
    ctx.beginPath();
    ctx.moveTo(padL, y(g));
    ctx.lineTo(w - padR, y(g));
    ctx.stroke();
    ctx.fillStyle = FG;
    ctx.fillText(`${g}%`, padL - 4, y(g));
  }
  const gw = (w - padL - padR) / buckets.length;
  const bw = Math.max(6, Math.min(22, gw * 0.3));
  buckets.forEach((b, i) => {
    const cx = padL + gw * i + gw / 2;
    const won = b.n ? (100 * b.wins) / b.n : 0;
    const price = b.avg_entry;
    const need = b.breakeven;
    const cleared = b.net >= 0; // the verdict is the cents; needs is the rate they imply
    ctx.fillStyle = FG;
    fillRound(ctx, cx - bw - 1.5, y(price), bw, Math.max(1, plotB - y(price)), 1);
    ctx.fillStyle = cleared ? UP : DOWN;
    fillRound(ctx, cx + 1.5, y(won), bw, Math.max(1, plotB - y(won)), 1);
    // breakeven after the fee: the mark the coloured bar has to reach
    ctx.strokeStyle = WAIT;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx - bw - 4, y(need));
    ctx.lineTo(cx + bw + 4, y(need));
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.font = FONT_SM;
    ctx.fillStyle = FG;
    ctx.fillText(bucketLabel(b), cx, plotB + 3);
    ctx.fillStyle = cleared ? UP : DOWN;
    ctx.fillText(`${Math.round(won)}% of ${b.n}`, cx, plotB + 14);
    ctx.fillStyle = WAIT;
    ctx.fillText(`needs ${Math.round(need)}%`, cx, plotB + 25);
  });
}

function CurveChart({
  pts,
  days,
  tz,
  since,
  trialSince,
  at,
}: {
  pts: BooksPoint[];
  days: BooksDay[];
  tz: string;
  since: string;
  trialSince: string | null;
  at: number;
}) {
  const ref = useDraw((ctx, w, h) => drawCurve(ctx, w, h, pts, days, tz, since, trialSince), `${at}:${tz}:${trialSince ?? ""}`);
  return <canvas ref={ref} className="block h-48 w-full rounded-sm" />;
}

function BucketChart({ buckets, at }: { buckets: BooksBucket[]; at: number }) {
  const ref = useDraw((ctx, w, h) => drawBuckets(ctx, w, h, buckets), at);
  return <canvas ref={ref} className="block h-44 w-full rounded-sm" />;
}

/* ---------- heat ---------- */

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

function hourLabel(h: number): string {
  if (h === 0) return "12a";
  if (h < 12) return `${h}a`;
  if (h === 12) return "12p";
  return `${h - 12}p`;
}

function Heat({ cells }: { cells: BooksHeatCell[] }) {
  const map = new Map<string, BooksHeatCell>();
  for (const c of cells) map.set(`${c.dow}:${c.hour}`, c);
  return (
    <div className="overflow-x-auto">
      <div className="grid min-w-[520px] gap-px font-mono text-micro" style={{ gridTemplateColumns: "2.2rem repeat(24, minmax(0, 1fr))" }}>
        <div />
        {HOURS.map((h) => (
          <div key={h} className="pb-1 text-center text-subtle">
            {h % 3 === 0 ? hourLabel(h) : ""}
          </div>
        ))}
        {[1, 2, 3, 4, 5, 6, 0].map((d) => (
          <div key={d} className="contents">
            <div className="pr-1 text-right text-subtle leading-5">{DOW[d]}</div>
            {HOURS.map((h) => {
              const c = map.get(`${d}:${h}`);
              const calls = c?.calls ?? 0;
              const net = c?.net ?? 0;
              const alpha = calls ? 0.18 + 0.72 * Math.min(1, Math.abs(net) / 40) : 0;
              const bg = !calls ? undefined : net > 0 ? `rgba(61,207,138,${alpha})` : net < 0 ? `rgba(239,107,115,${alpha})` : "rgba(139,144,160,0.25)";
              const title = c
                ? `${DOW[d]} ${hourLabel(h)} · ${c.n} windows · ${calls} calls · ${c.wins} won · ${fmtC(net)}`
                : `${DOW[d]} ${hourLabel(h)} · no windows yet`;
              return <div key={h} title={title} className={cn("h-5 rounded-[2px] border border-border/60", !calls && "bg-surface")} style={bg ? { background: bg } : undefined} />;
            })}
          </div>
        ))}
      </div>
      <div className="mt-1 text-subtle text-micro">Chicago time · hover a cell</div>
    </div>
  );
}

/* ---------- panes ---------- */

/** The lab's stale-quote study, one trade per window. A measurement of the market, not a strategy the chair can run. */
function LabPane({ lab, tz }: { lab: BooksLab | null; tz: string }) {
  return (
    <Pane title={<Tip k="books.lab">THE LAB · STALE QUOTES</Tip>}>
      {!lab ? (
        <div className="font-mono text-micro text-muted">the lab has no settled shocks yet</div>
      ) : (
        <>
          <div className="grid gap-3 font-mono text-micro sm:grid-cols-3">
            <div>
              <div className="text-subtle">windows studied</div>
              <div className="font-mono text-data tabular text-fg">{lab.windows}</div>
              <div className="text-subtle">
                {lab.shocks} fillable shocks{lab.since ? ` · since ${fmtDay(lab.since, tz)}` : ""}
                {lab.stale_ms != null ? ` · a stale ask lasts ${(lab.stale_ms / 1000).toFixed(1)}s` : ""}
              </div>
            </div>
            <div>
              <div className="text-subtle">first shock per window</div>
              <div className={cn("font-mono text-data tabular", tone(lab.first.avg))}>{fmtC(lab.first.avg)} avg</div>
              <div className="text-subtle">
                {pct(lab.first.pos, lab.first.n)} positive · {fmtC(lab.first.sum, 0)} over {lab.first.n} windows
              </div>
            </div>
            <div>
              <div className="text-subtle">final minute, first shock</div>
              <div className={cn("font-mono text-data tabular", tone(lab.final.avg))}>{fmtC(lab.final.avg)} avg</div>
              <div className="text-subtle">
                {pct(lab.final.pos, lab.final.n)} positive over {lab.final.n} · at a {lab.final.ask.toFixed(0)}¢ ask · claimed {fmtC(lab.final.claimed)}
              </div>
            </div>
          </div>
          <p className="mt-3 max-w-[78ch] font-mono text-micro leading-relaxed text-subtle">
            A shock is the settlement index jumping while an ask stayed put; fillable means the stale ask was still there 200 ms later. One paper trade per
            window, bought at that ask and held to settlement after the fee, so a burst of correlated shocks cannot inflate it. This edge lives at 200 ms
            on the cheap side; the chair ticks every four seconds and books only at the live {FLOOR_LIVE_CENTS}¢ floor or better, so it is not chasing it. INDEX brings the read to the council
            instead. Nothing trades on it.
          </p>
        </>
      )}
    </Pane>
  );
}

function Totals({ label, t }: { label: ReactNode; t: BooksTotals }) {
  const won = t.calls ? (100 * t.wins) / t.calls : null;
  const need = t.breakeven;
  const cleared = t.calls ? t.net >= 0 : null; // the verdict is the cents; needs is the rate they imply
  return (
    <div className="min-w-0 rounded-sm border border-border/60 p-2">
      <div className="text-subtle text-micro">{label}</div>
      <div className={cn("font-mono text-call tabular", tone(t.net))}>{fmtC(t.net)}</div>
      <div className="font-mono text-micro text-muted">
        {t.calls} calls · {t.wins} won
      </div>
      <div className="font-mono text-micro text-muted">
        <span className={cleared == null ? "text-subtle" : cleared ? "text-up" : "text-down"}>{won == null ? "—" : `${won.toFixed(1)}%`}</span> won ·{" "}
        <Tip k="books.needs">needs {need == null ? "—" : `${need.toFixed(1)}%`}</Tip>
      </div>
      <div className="font-mono text-micro text-subtle">
        {t.n} windows · UP won {pct(t.ups, t.n)}
      </div>
    </div>
  );
}

function KeeperMetric({ k, gloss, v, sub, t }: { k: string; gloss: string; v: string; sub?: string; t?: string }) {
  return (
    <div className="min-w-0">
      <div className="font-mono text-micro uppercase tracking-wider text-subtle">
        <Tip k={gloss}>{k}</Tip>
      </div>
      <div className={cn("font-mono text-data tabular", t ?? "text-fg")}>{v}</div>
      {sub ? <div className="truncate font-mono text-micro text-subtle">{sub}</div> : null}
    </div>
  );
}

function KeeperCol({ label, s }: { label: string; s: KeeperStats }) {
  return (
    <div className="min-w-0 rounded-sm border border-border/60 p-2">
      <div className="mb-1.5 font-mono text-micro uppercase tracking-widest text-subtle">{label}</div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 min-[380px]:grid-cols-3">
        <KeeperMetric k="sits" gloss="keeper.wait" v={`${s.wait_pct}%`} sub={`${s.n} windows`} />
        <KeeperMetric k="fills" gloss="keeper.booked" v={String(s.booked)} sub={s.avg_entry == null ? "no fills" : `avg ${s.avg_entry.toFixed(0)}¢`} />
        <KeeperMetric k="win rate" gloss="keeper.hit" v={s.hit_pct == null ? "—" : `${s.hit_pct}%`} t={s.hit_pct == null ? "text-subtle" : s.hit_pct >= 50 ? "text-up" : "text-down"} />
        <KeeperMetric k="net" gloss="keeper.net" v={fmtC(s.net)} t={tone(s.net)} />
        <KeeperMetric k="max drawdown" gloss="keeper.dd" v={s.max_dd ? fmtC(s.max_dd) : "—"} t={s.max_dd ? "text-down" : "text-subtle"} />
        <KeeperMetric k="confluence" gloss="keeper.conf" v={s.conf_ratio == null ? "—" : `${s.conf_ratio.toFixed(2)}×`} sub={s.floor_pct == null ? undefined : `floor kept ${s.floor_pct}%`} />
      </div>
    </div>
  );
}

/** The 80¢ floor trial: the live book beside the old floor's shadow book, on
 *  the same windows. The shadow side is research and is never the headline. */
function TrialPane({ trial, tz }: { trial: FloorTrial; tz: string }) {
  const thin = trial.live.calls < 25;
  const col = (label: string, t: BooksTotals, cents: number, research: boolean) => {
    const won = t.calls ? (100 * t.wins) / t.calls : null;
    const cleared = t.calls ? t.net >= 0 : null;
    return (
      <div className="min-w-0 rounded-sm border border-border/60 p-2">
        <div className="text-subtle text-micro">
          {label} · {cents}¢{research ? " · research" : null}
        </div>
        <div className={cn("font-mono text-call tabular", research ? "text-muted" : tone(t.net))}>{fmtC(t.net)}</div>
        <div className="font-mono text-micro text-muted">
          {t.calls} fills · {t.wins} won
        </div>
        <div className="font-mono text-micro text-muted">
          <span className={cleared == null ? "text-subtle" : cleared ? "text-up" : "text-down"}>
            {won == null ? "—" : `${won.toFixed(1)}%`}
          </span>{" "}
          won · needs {t.breakeven == null ? "—" : `${t.breakeven.toFixed(1)}%`}
        </div>
      </div>
    );
  };
  return (
    <Pane
      title={
        <span>
          <Tip k="books.trial">THE {trial.live_cents}¢ FLOOR TRIAL</Tip>{" "}
          <span className="font-normal text-subtle">· {trial.until ? "archived" : "since"} {fmtDay(trial.since, tz)}{trial.until ? `–${fmtDay(trial.until, tz)}` : ""} · {trial.windows} windows</span>
        </span>
      }
    >
      <div className="grid gap-2 sm:grid-cols-2">
        {col("live book", trial.live, trial.live_cents, false)}
        {col("shadow book", trial.shadow, trial.shadow_cents, true)}
      </div>
      <p className="mt-2 font-mono text-micro text-subtle">
        {trial.until ? "This comparison ended before selective mode. New selective results are recorded separately. " : ""}
        Same windows, two floors. The live book pays {trial.live_cents}¢ or better; the shadow book counts what the old{" "}
        {trial.shadow_cents}¢ floor would have taken, and books nothing. It declined {trial.declined} fill
        {trial.declined === 1 ? "" : "s"} the old floor would have made. A higher floor wins more often for a smaller
        prize, so its breakeven is higher too — read the net, not the win rate.
        {thin ? ` Only ${trial.live.calls} live fills so far: too few to judge.` : ""}
      </p>
    </Pane>
  );
}

/** KEEPER — not "did it win" but "did it play the way it says." */
function KeeperPane({ keeper }: { keeper: Keeper }) {
  return (
    <Pane title={<Tip k="keeper.pane">PROCESS SCORECARD</Tip>}>
      <div className="grid gap-2 sm:grid-cols-2">
        <KeeperCol label="all-time" s={keeper.all} />
        <KeeperCol label="last 7 days" s={keeper.week} />
      </div>
      <p className="mt-2 font-mono text-micro text-subtle">
        Sits is how often the chair passed. Confluence is how hard the fills cleared the bar; floor kept is the share that honoured the floor in
        force when they closed — {FLOOR_LIVE_CENTS}¢ during the trial, {FLOOR_SHADOW_CENTS}¢ before it. Max drawdown is the worst peak-to-trough on
        paper. Every call is graded at its own 15-minute close.
      </p>
    </Pane>
  );
}

function CallCell({ c }: { c: BooksWindow["call"] }) {
  if (!c) return <span className="text-subtle">sat out</span>;
  if (c.lean) {
    return (
      <span className="inline-flex flex-wrap items-center gap-1">
        <LeanChip lean={c.lean} cents={c.entry} />
        <span className="text-subtle">→ {c.settle == null ? "open" : `${c.settle.toFixed(0)}¢`}</span>
      </span>
    );
  }
  return (
    <span className="text-muted">
      {c.entry.toFixed(0)}¢ → cut {c.settle == null ? "—" : `${c.settle.toFixed(0)}¢`}
    </span>
  );
}

function LastWindow({ wnd, tz, onReplay }: { wnd: BooksWindow; tz: string; onReplay: (ticker: string) => void }) {
  const c = wnd.call;
  return (
    <Pane
      title={
        <span className="inline-flex items-center gap-2">
          <Tip k="books.last">LAST WINDOW</Tip>
          {wnd.replay ? (
            <button type="button" className="rounded-sm border border-border px-1.5 py-px font-mono text-micro font-normal text-subtle hover:text-fg" onClick={() => onReplay(wnd.ticker)}>
              ▶ replay
            </button>
          ) : null}
        </span>
      }
    >
      <div className="grid gap-2 font-mono text-data sm:grid-cols-2">
        <div className="min-w-0">
          <div className="text-subtle text-micro">{fmtWhen(wnd.close_time, tz)} close · {wnd.ticker}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <LeanChip lean={wnd.winner} />
            <span className="text-muted">
              settled <span className="text-fg">{fmtPx(wnd.official ?? wnd.settle_avg)}</span>
              {wnd.official == null && wnd.settle_avg != null ? <span className="text-subtle"> (our average, official pending)</span> : null}
            </span>
          </div>
          <div className="mt-1 text-micro text-subtle">
            {wnd.prints != null ? `${wnd.prints} of 60 final-minute prints seen` : "final minute not recorded"}
          </div>
        </div>
        <div className="min-w-0">
          <div className="text-subtle text-micro">the chair</div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <CallCell c={c} />
            {c ? <span className={cn("tabular", tone(c.ev))}>{fmtC(c.ev)}</span> : null}
          </div>
          <div className="mt-1 text-micro text-muted">
            {wnd.seats.n ? `${wnd.seats.right} of ${wnd.seats.n} speaking seats right` : "no seat spoke"} · {wnd.raw.n ? `${wnd.raw.right} of ${wnd.raw.n} reads right` : "no reads"}
          </div>
          <div className="mt-1 text-micro text-muted">
            arena: {wnd.arena ? `${wnd.arena.n} call${wnd.arena.n === 1 ? "" : "s"} · ${fmtC(wnd.arena.net)}` : "no calls"}
          </div>
        </div>
      </div>
    </Pane>
  );
}

export function BooksTab({ tz, initial }: { tz: string; initial?: Books | null }) {
  const [books, setBooks] = useState<Books | null>(initial ?? null);
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const replayPanel = useRef<HTMLElement>(null);
  const replayOpener = useRef<HTMLElement | null>(null);
  const openReplay = (ticker: string) => {
    replayOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSel(ticker);
    if (sel === ticker) {
      replayPanel.current?.focus({ preventScroll: true });
      replayPanel.current?.scrollIntoView({ block: "start" });
    }
  };
  const closeReplay = () => {
    setSel(null);
    replayOpener.current?.focus();
  };
  useEffect(() => {
    if (!sel) return;
    replayPanel.current?.focus({ preventScroll: true });
    replayPanel.current?.scrollIntoView({ block: "start" });
  }, [sel]);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const b = await fetchBooks();
        if (alive) {
          setBooks(b);
          setErr(null);
        }
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : String(e));
      }
    };
    void load();
    const id = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  if (!books) {
    return (
      <div className="grid gap-3">
        <Pane title={<Tip k="tab.books">BOOKS</Tip>}>
          <div className="font-mono text-micro text-muted">{err ? `the books are closed right now: ${err}` : "opening the books…"}</div>
        </Pane>
      </div>
    );
  }

  const missing = books.missing_windows ?? [];
  const oldest = books.windows.at(-1)?.close_time;
  const newest = books.windows[0]?.close_time;
  const windowRows = [...books.windows, ...missing.filter((close) => oldest && newest && close >= oldest && close <= newest).map((close_time) => ({ close_time, missing: true as const }))]
    .sort((a, b) => b.close_time.localeCompare(a.close_time));

  return (
    <div className="books-content grid min-w-0 grid-cols-1 gap-3">
      <nav
        className="flex flex-wrap gap-1 rounded-md border border-border bg-canvas p-2"
        aria-label="Paper book sections"
      >
        {[
          ["#books-overview", "Overview"],
          ["#books-process", "Process"],
          ["#books-curve", "Curve"],
          ["#books-calibration", "Calibration"],
          ["#books-lab", "Lab"],
          ["#books-windows", "Recent windows"],
        ].map(([href, label]) => (
          <a
            key={href}
            href={href}
            className="btn btn-sm text-muted hover:text-fg"
          >
            {label}
          </a>
        ))}
      </nav>

      {missing.length > 0 ? (
        <section aria-label="Missing ledger windows" className="rounded-md border border-wait/40 bg-wait/10 p-3">
          <p className="font-mono text-ui text-wait">{missing.length} missing {missing.length === 1 ? "window" : "windows"} in the last 90 days of recorded coverage</p>
          <p className="mt-1 font-mono text-micro text-muted">These gaps have no recorded grading result. They are not WAITs, wins, losses, or zero-profit trades.</p>
          <details className="mt-2 font-mono text-micro text-muted">
            <summary className="min-h-11 cursor-pointer py-2">Show missing closes · {tz}</summary>
            <ul className="max-h-60 overflow-y-auto">{missing.slice(-100).reverse().map((close) => <li key={close} className="py-1"><time dateTime={close}>{fmtWhen(close, tz)}</time> · missing data</li>)}</ul>
            {missing.length > 100 ? <p>Showing the most recent 100 missing closes.</p> : null}
          </details>
          <a href="/status" className="font-mono text-micro underline underline-offset-2">View data status</a>
        </section>
      ) : null}

      <section id="books-overview" className="grid grid-cols-1 scroll-mt-20 gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        {books.last ? (
          <LastWindow wnd={books.last} tz={tz} onReplay={openReplay} />
        ) : (
          <Pane title={<Tip k="books.last">LAST WINDOW</Tip>}>
            <div className="font-mono text-micro text-muted">no graded windows yet</div>
          </Pane>
        )}
        <Pane title={<Tip k="tab.books">THE BOOKS</Tip>}>
          <div className="grid grid-cols-2 gap-2">
            <Totals label="today" t={books.today} />
            <Totals label="last 7 days" t={books.week} />
            <Totals label="since floor introduced" t={books.floor} />
            <Totals label="all-time" t={books.all} />
          </div>
          <p className="mt-3 font-mono text-micro leading-relaxed text-subtle">
            Overlapping periods, not separate books. The floor period starts {fmtWhen(books.floor_since, tz)} and includes the later {FLOOR_LIVE_CENTS}¢ trial. Trial results are already in these totals; the shadow comparison is never added. Today uses America/Chicago; row times use {tz}.
          </p>
          {err ? <div className="mt-2 font-mono text-micro text-wait">last refresh failed: {err}</div> : null}
        </Pane>
      </section>

      <section id="books-process" className="grid grid-cols-1 scroll-mt-20 gap-3">
        {books.trial ? <TrialPane trial={books.trial} tz={tz} /> : null}

        {books.keeper ? (
        <KeeperPane keeper={books.keeper} />
      ) : (
        <Pane title={<Tip k="keeper.pane">PROCESS SCORECARD</Tip>}>
          <div className="font-mono text-micro text-wait">
            The scorecard could not be read this refresh, so it is blank rather than showing zeros — the chair has not
            stopped trading.
          </div>
          {books.keeper_error ? (
            <div className="mt-1 truncate font-mono text-micro text-subtle">{books.keeper_error}</div>
          ) : null}
        </Pane>
        )}
      </section>

      <section id="books-curve" className="scroll-mt-20">
        <Pane title={<Tip k="books.curve">THE CURVE · 14 DAYS</Tip>}>
        <CurveChart
          pts={books.curve}
          days={books.days}
          tz={tz}
          since={books.floor_since}
          trialSince={books.trial?.since ?? null}
          at={books.at}
        />
        </Pane>
      </section>

      <section id="books-calibration" className="grid grid-cols-1 scroll-mt-20 gap-3 lg:grid-cols-2">
        <Pane title={<Tip k="books.calib">DID THE PRICE TELL THE TRUTH?</Tip>}>
          <BucketChart buckets={books.buckets} at={books.at} />
          <p className="mt-1 font-mono text-micro text-subtle">grey = price paid · gold = breakeven after the fee · green or red = the shelf cleared it or fell short</p>
        </Pane>
        <Pane title={<Tip k="books.heat">HOURS</Tip>}>
          <Heat cells={books.heat} />
        </Pane>
      </section>

      <section id="books-lab" className="scroll-mt-20">
        <LabPane lab={books.lab} tz={tz} />
      </section>

      {sel ? (
        <section id="books-replay" ref={replayPanel} tabIndex={-1} aria-label="Window replay" className="scroll-mt-20 outline-none">
          <ReplayPane ticker={sel} tz={tz} onClose={closeReplay} />
        </section>
      ) : null}

      <section id="books-windows" className="scroll-mt-20">
        <Pane title={<span>RECENT WINDOWS <span className="font-normal text-subtle">· open a window with ▶ to replay it</span></span>}>
          <div className="overflow-x-auto">
          <table role="table" className="books-window-table w-full font-mono text-micro">
            <caption className="sr-only">Recent paper windows, including missing ledger slots. Times in {tz}.</caption>
            <thead>
              <tr className="text-left">
                <th >close</th>
                <th >result</th>
                <th >settled</th>
                <th >chair</th>
                <th className="text-right">cents</th>
                <th className="text-right">seats</th>
                <th className="text-right">reads</th>
                <th className="py-1 text-right">arena</th>
              </tr>
            </thead>
            <tbody>
              {windowRows.map((w) => "missing" in w ? (
                <tr key={w.close_time} role="row" className="border-t border-wait/40 bg-wait/10">
                  <td role="cell" data-label="Close" className="py-3 text-muted">{fmtWhen(w.close_time, tz)}</td>
                  <td role="cell" colSpan={7} className="books-missing-cell py-3 text-wait">Missing ledger data · result and paper profit unavailable. Excluded from totals.</td>
                </tr>
              ) : (
                <tr
                  key={`${w.ticker}:${w.close_time}`}
                  role="row"
                  className={cn("border-t border-border/50", w.replay && "hover:bg-surface-2/40", sel === w.ticker && "bg-surface-2/60")}
                >
                  <td role="cell" data-label="Close" className="whitespace-nowrap text-muted">
                    {w.replay ? (
                      <button
                        type="button"
                        className="min-h-11 rounded-sm py-2 text-left text-fg hover:underline"
                        aria-label={`${fmtWhen(w.close_time, tz)} · open replay`}
                        aria-expanded={sel === w.ticker}
                        aria-controls={sel === w.ticker ? "books-replay" : undefined}
                        onClick={() => openReplay(w.ticker)}
                      >
                        <span aria-hidden="true" className="mr-1">▶</span>{fmtWhen(w.close_time, tz)}
                      </button>
                    ) : <span>· {fmtWhen(w.close_time, tz)}</span>}
                  </td>
                  <td role="cell" data-label="Result">
                    <LeanChip lean={w.winner} />
                  </td>
                  <td role="cell" data-label="Settled" className="tabular text-muted">{fmtPx(w.official ?? w.settle_avg)}</td>
                  <td role="cell" data-label="Chair">
                    <CallCell c={w.call} />
                  </td>
                  <td role="cell" data-label="Paper cents" className={cn("text-right tabular", tone(w.call?.ev))}>{w.call ? fmtC(w.call.ev) : "no fill"}</td>
                  <td role="cell" data-label="Seats" className="text-right tabular text-muted">{w.seats.n ? `${w.seats.right}/${w.seats.n}` : "—"}</td>
                  <td role="cell" data-label="Reads" className="text-right tabular text-muted">{w.raw.n ? `${w.raw.right}/${w.raw.n}` : "—"}</td>
                  <td role="cell" data-label="Arena" className={cn("py-1 text-right tabular", w.arena ? tone(w.arena.net) : "text-subtle")}>
                    {w.arena ? `${w.arena.n} · ${fmtC(w.arena.net)}` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </Pane>
      </section>
    </div>
  );
}
