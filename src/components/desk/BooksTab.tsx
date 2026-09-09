import { useEffect, useState } from "react";
import {
  fetchBooks,
  type BooksLab,
  type Books,
  type BooksBucket,
  type BooksDay,
  type BooksHeatCell,
  type BooksPoint,
  type BooksTotals,
  type BooksWindow,
} from "@/lib/desk/books";
import { cn } from "@/lib/utils";
import { LeanChip, Pane } from "./bits";
import { Tip } from "./Tip";
import { ReplayPane } from "./ReplayPane";
import { BG, DOWN, FG, FONT, FONT_SM, GRID, INK, LINE, UP, fillRound, useDraw } from "./canvas";

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

function drawCurve(ctx: CanvasRenderingContext2D, w: number, h: number, pts: BooksPoint[], days: BooksDay[], tz: string) {
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
  const padT = 18;
  const padB = 18;
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
    ctx.fillStyle = FG;
    fillRound(ctx, cx - bw - 1.5, y(price), bw, Math.max(1, plotB - y(price)), 1);
    ctx.fillStyle = won >= price ? UP : DOWN;
    fillRound(ctx, cx + 1.5, y(won), bw, Math.max(1, plotB - y(won)), 1);
    ctx.fillStyle = LINE;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.font = FONT_SM;
    ctx.fillText(`${Math.round(won)}% of ${b.n}`, cx, Math.min(y(price), y(won)) - 2);
    ctx.fillStyle = FG;
    ctx.textBaseline = "top";
    ctx.fillText(bucketLabel(b), cx, plotB + 3);
  });
  ctx.font = FONT;
  ctx.fillStyle = FG;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("grey = price paid · colour = how often it won", padL, 2);
}

function CurveChart({ pts, days, tz, at }: { pts: BooksPoint[]; days: BooksDay[]; tz: string; at: number }) {
  const ref = useDraw((ctx, w, h) => drawCurve(ctx, w, h, pts, days, tz), `${at}:${tz}`);
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
            on the cheap side; the chair ticks every four seconds and books at 70¢ or better, so it is not chasing it. INDEX brings the read to the council
            instead. Nothing trades on it.
          </p>
        </>
      )}
    </Pane>
  );
}

function Totals({ label, t }: { label: string; t: BooksTotals }) {
  return (
    <div className="min-w-0 rounded-sm border border-border/60 p-2">
      <div className="text-subtle text-micro">{label}</div>
      <div className={cn("font-mono text-call tabular", tone(t.net))}>{fmtC(t.net)}</div>
      <div className="font-mono text-micro text-muted">
        {t.calls} calls · {t.wins} won ({pct(t.wins, t.calls)})
      </div>
      <div className="font-mono text-micro text-subtle">
        {t.n} windows · UP won {pct(t.ups, t.n)}
      </div>
    </div>
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

export function BooksTab({ tz }: { tz: string }) {
  const [books, setBooks] = useState<Books | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
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

  return (
    <div className="grid gap-3">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        {books.last ? (
          <LastWindow wnd={books.last} tz={tz} onReplay={setSel} />
        ) : (
          <Pane title={<Tip k="books.last">LAST WINDOW</Tip>}>
            <div className="font-mono text-micro text-muted">no graded windows yet</div>
          </Pane>
        )}
        <Pane title={<Tip k="tab.books">THE BOOKS</Tip>}>
          <div className="grid grid-cols-3 gap-2">
            <Totals label="today" t={books.today} />
            <Totals label="this week" t={books.week} />
            <Totals label="all-time" t={books.all} />
          </div>
          {err ? <div className="mt-2 font-mono text-micro text-wait">last refresh failed: {err}</div> : null}
        </Pane>
      </div>

      <Pane title={<Tip k="books.curve">THE CURVE · 14 DAYS</Tip>}>
        <CurveChart pts={books.curve} days={books.days} tz={tz} at={books.at} />
      </Pane>

      <div className="grid gap-3 lg:grid-cols-2">
        <Pane title={<Tip k="books.calib">DID THE PRICE TELL THE TRUTH?</Tip>}>
          <BucketChart buckets={books.buckets} at={books.at} />
        </Pane>
        <Pane title={<Tip k="books.heat">HOURS</Tip>}>
          <Heat cells={books.heat} />
        </Pane>
      </div>

      <LabPane lab={books.lab} tz={tz} />

      {sel ? <ReplayPane ticker={sel} tz={tz} onClose={() => setSel(null)} /> : null}

      <Pane title={<span>LAST 40 WINDOWS <span className="font-normal text-subtle">· click a window with ▶ to replay it</span></span>}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] font-mono text-micro">
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
              {books.windows.map((w) => (
                <tr
                  key={w.ticker}
                  className={cn("border-t border-border/50", w.replay && "cursor-pointer hover:bg-surface-2/40", sel === w.ticker && "bg-surface-2/60")}
                  onClick={() => (w.replay ? setSel(sel === w.ticker ? null : w.ticker) : undefined)}
                >
                  <td className="whitespace-nowrap text-muted">
                    <span className={cn("mr-1", w.replay ? "text-fg" : "text-subtle/40")}>{w.replay ? "▶" : "·"}</span>
                    {fmtWhen(w.close_time, tz)}
                  </td>
                  <td >
                    <LeanChip lean={w.winner} />
                  </td>
                  <td className="tabular text-muted">{fmtPx(w.official ?? w.settle_avg)}</td>
                  <td >
                    <CallCell c={w.call} />
                  </td>
                  <td className={cn("text-right tabular", tone(w.call?.ev))}>{w.call ? fmtC(w.call.ev) : ""}</td>
                  <td className="text-right tabular text-muted">{w.seats.n ? `${w.seats.right}/${w.seats.n}` : "—"}</td>
                  <td className="text-right tabular text-muted">{w.raw.n ? `${w.raw.right}/${w.raw.n}` : "—"}</td>
                  <td className={cn("py-1 text-right tabular", w.arena ? tone(w.arena.net) : "text-subtle")}>
                    {w.arena ? `${w.arena.n} · ${fmtC(w.arena.net)}` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Pane>
    </div>
  );
}
