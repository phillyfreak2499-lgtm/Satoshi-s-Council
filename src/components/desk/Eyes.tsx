import { useEffect, useRef } from "react";
import type { Candle, SeatId, Snapshot, Vote } from "@/lib/desk/types";
import { round } from "@/lib/desk/math";
import { MARK_LABEL, readWick, type MarkKind, type WickMark } from "@/lib/desk/patterns";
import { ledgerRows } from "@/lib/desk/ledger";
import { readDrift, readExhaust, readStreak } from "@/lib/desk/structure";
import { useDesk } from "@/lib/desk/store";
import { HealthDot } from "./bits";
import { Tip } from "./Tip";

const UP = "#3dcf8a";
const DOWN = "#ef6b73";
const WAIT = "#d4a017";
const GRID = "#232833";
const FG = "#8b90a0";
const LINE = "#c8ccd4";

function useDraw(draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, dep: unknown) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = c.clientWidth || 320;
    const h = c.clientHeight || 140;
    c.width = Math.floor(w * dpr);
    c.height = Math.floor(h * dpr);
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    draw(ctx, w, h);
  }, [dep, draw]);
  return ref;
}

function candles(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  bars: Snapshot["candles_1m"],
  strike?: number,
  mark?: number,
) {
  if (!bars.length) return;
  const pad = 8;
  const slice = bars.slice(-60);
  const hi = Math.max(...slice.map((b) => b.high), strike ?? -Infinity);
  const lo = Math.min(...slice.map((b) => b.low), strike ?? Infinity);
  const span = Math.max(1, hi - lo);
  const bw = (w - pad * 2) / slice.length;
  const y = (p: number) => pad + ((hi - p) / span) * (h - pad * 2);
  ctx.strokeStyle = GRID;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, y((hi + lo) / 2));
  ctx.lineTo(w, y((hi + lo) / 2));
  ctx.stroke();
  if (strike) {
    ctx.strokeStyle = WAIT;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(0, y(strike));
    ctx.lineTo(w, y(strike));
    ctx.stroke();
    ctx.setLineDash([]);
  }
  slice.forEach((b, i) => {
    const x = pad + i * bw + bw * 0.5;
    const up = b.close >= b.open;
    ctx.strokeStyle = up ? UP : DOWN;
    ctx.fillStyle = up ? UP : DOWN;
    ctx.beginPath();
    ctx.moveTo(x, y(b.high));
    ctx.lineTo(x, y(b.low));
    ctx.stroke();
    const top = y(Math.max(b.open, b.close));
    const bot = y(Math.min(b.open, b.close));
    ctx.fillRect(x - bw * 0.3, top, Math.max(1, bw * 0.6), Math.max(1, bot - top));
    if (mark === i) {
      ctx.strokeStyle = WAIT;
      ctx.strokeRect(x - bw * 0.45, y(b.high) - 2, bw * 0.9, y(b.low) - y(b.high) + 4);
    }
  });
}

function spark(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  xs: number[],
  color: string,
  mid?: number,
) {
  if (xs.length < 2) return;
  const pad = 8;
  const hi = Math.max(...xs, mid ?? -Infinity);
  const lo = Math.min(...xs, mid ?? Infinity);
  const span = Math.max(1e-9, hi - lo);
  const y = (p: number) => pad + ((hi - p) / span) * (h - pad * 2);
  if (mid != null) {
    ctx.strokeStyle = GRID;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(0, y(mid));
    ctx.lineTo(w, y(mid));
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  xs.forEach((v, i) => {
    const x = pad + (i / (xs.length - 1)) * (w - pad * 2);
    if (i === 0) ctx.moveTo(x, y(v));
    else ctx.lineTo(x, y(v));
  });
  ctx.stroke();
}

function hist(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  xs: number[],
  colorFor: (v: number, i: number) => string,
) {
  if (!xs.length) return;
  const pad = 8;
  const max = Math.max(...xs.map(Math.abs), 1e-9);
  const bw = (w - pad * 2) / xs.length;
  const mid = h / 2;
  xs.forEach((v, i) => {
    ctx.fillStyle = colorFor(v, i);
    const bh = (Math.abs(v) / max) * (h / 2 - pad);
    const x = pad + i * bw;
    if (v >= 0) ctx.fillRect(x, mid - bh, Math.max(1, bw - 1), bh);
    else ctx.fillRect(x, mid, Math.max(1, bw - 1), bh);
  });
}

function Empty({ text }: { text: string }) {
  return (
    <div className="flex h-36 items-center justify-center border border-dashed border-border bg-surface-2 font-mono text-ui text-muted">
      {text}
    </div>
  );
}

function markColor(kind: MarkKind, lean: WickMark["lean"]): string {
  if (lean === "UP") return UP;
  if (lean === "DOWN") return DOWN;
  return WAIT;
}

function labelWick(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string) {
  ctx.save();
  ctx.font = "9px ui-monospace, 'IBM Plex Mono', monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  const tw = ctx.measureText(text).width + 6;
  ctx.fillStyle = "#101217";
  ctx.fillRect(x - tw / 2, y - 10, tw, 10);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.strokeRect(x - tw / 2, y - 10, tw, 10);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y - 1);
  ctx.restore();
}

function drawWick(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  bars: Candle[],
  skill: string,
  location: Snapshot["location"],
) {
  const read = readWick(bars);
  const slice = read.slice;
  const marks = read.marks;
  if (!slice.length) return;
  const padX = 8;
  const padT = 14;
  const padB = 10;
  const locSlice = slice.slice(-20);
  const locHi = Math.max(...locSlice.map((b) => b.high));
  const locLo = Math.min(...locSlice.map((b) => b.low));
  const hi = Math.max(...slice.map((b) => b.high), locHi);
  const lo = Math.min(...slice.map((b) => b.low), locLo);
  const span = Math.max(1, hi - lo);
  const bw = (w - padX * 2) / slice.length;
  const y = (p: number) => padT + ((hi - p) / span) * (h - padT - padB);
  const xAt = (i: number) => padX + i * bw + bw * 0.5;

  const yHigh = y(locLo + 0.8 * (locHi - locLo));
  const yLow = y(locLo + 0.2 * (locHi - locLo));
  ctx.fillStyle = "rgba(61, 207, 138, 0.06)";
  ctx.fillRect(0, padT, w, Math.max(0, yHigh - padT));
  ctx.fillStyle = "rgba(239, 107, 115, 0.06)";
  ctx.fillRect(0, yLow, w, Math.max(0, h - padB - yLow));
  ctx.strokeStyle = GRID;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(0, yHigh);
  ctx.lineTo(w, yHigh);
  ctx.moveTo(0, yLow);
  ctx.lineTo(w, yLow);
  ctx.stroke();
  ctx.setLineDash([]);

  if (read.amd) {
    const { acc, manipI, distI, phase, lean } = read.amd;
    const x0 = xAt(acc.i0) - bw * 0.45;
    const x1 = xAt(acc.i1) + bw * 0.45;
    ctx.fillStyle = "rgba(200, 204, 212, 0.06)";
    ctx.fillRect(x0, y(acc.hi), Math.max(2, x1 - x0), Math.max(2, y(acc.lo) - y(acc.hi)));
    ctx.strokeStyle = LINE;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(x0, y(acc.hi), Math.max(2, x1 - x0), Math.max(2, y(acc.lo) - y(acc.hi)));
    ctx.setLineDash([]);
    const tag =
      phase === "DISTRIBUTION" ? `AMD ${lean}` : phase === "MANIPULATION" ? "AMD MANIP" : "AMD ACC";
    labelWick(ctx, tag, (x0 + x1) / 2, y(acc.hi) - 1, phase === "DISTRIBUTION" ? markColor("amd", lean) : WAIT);
    if (manipI != null) {
      const b = slice[manipI]!;
      ctx.strokeStyle = WAIT;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(xAt(manipI), y(b.high));
      ctx.lineTo(xAt(manipI), y(b.low));
      ctx.stroke();
    }
    if (distI != null) {
      const b = slice[distI]!;
      ctx.strokeStyle = lean === "UP" ? UP : DOWN;
      ctx.lineWidth = 1.4;
      ctx.strokeRect(xAt(distI) - bw * 0.48, y(b.high) - 3, bw * 0.96, y(b.low) - y(b.high) + 6);
    }
  }

  for (const s of [...read.structure.highs, ...read.structure.lows].slice(-8)) {
    const isHi = read.structure.highs.includes(s);
    ctx.fillStyle = isHi ? DOWN : UP;
    ctx.beginPath();
    ctx.arc(xAt(s.i), y(s.px), 2.2, 0, Math.PI * 2);
    ctx.fill();
  }

  const lastClosed = [...slice].reverse().find((b) => b.closed) ?? slice[slice.length - 1]!;
  const fireI = slice.lastIndexOf(lastClosed);

  slice.forEach((b, i) => {
    const x = xAt(i);
    const up = b.close >= b.open;
    const kinds = marks.filter((m) => m.i === i).map((m) => m.kind);
    const reject = kinds.some((k) =>
      ["pin", "hammer", "hanging", "inv_ham", "shoot", "dragonfly", "gravestone", "sweep-up", "sweep-dn"].includes(
        k,
      ),
    );
    const isDoji = kinds.some((k) => ["doji", "long_leg", "dragonfly", "gravestone"].includes(k));
    const isMaru = kinds.includes("marubozu");
    ctx.globalAlpha = b.closed ? 1 : 0.5;
    ctx.strokeStyle = reject ? WAIT : up ? UP : DOWN;
    ctx.fillStyle = up ? UP : DOWN;
    ctx.lineWidth = reject ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(x, y(b.high));
    ctx.lineTo(x, y(b.low));
    ctx.stroke();
    const top = y(Math.max(b.open, b.close));
    const bot = y(Math.min(b.open, b.close));
    const bh = Math.max(1, bot - top);
    if (isDoji) {
      ctx.strokeStyle = WAIT;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x - bw * 0.35, (top + bot) / 2);
      ctx.lineTo(x + bw * 0.35, (top + bot) / 2);
      ctx.stroke();
    } else {
      ctx.fillRect(x - bw * 0.28, top, Math.max(1, bw * 0.56), bh);
      if (isMaru) {
        ctx.strokeStyle = LINE;
        ctx.lineWidth = 1;
        ctx.strokeRect(x - bw * 0.3, top, Math.max(1, bw * 0.6), bh);
      }
    }
    ctx.globalAlpha = 1;
  });

  for (const m of marks) {
    if ((m.span ?? 1) < 2) continue;
    const i0 = Math.max(0, m.i - (m.span - 1));
    const prev = slice[i0]!;
    const bar = slice[m.i]!;
    const x0 = xAt(i0) - bw * 0.4;
    const x1 = xAt(m.i) + bw * 0.4;
    const top = Math.min(y(prev.high), y(bar.high)) - 3;
    const bot = Math.max(y(prev.low), y(bar.low)) + 3;
    ctx.strokeStyle = markColor(m.kind, m.lean);
    ctx.lineWidth = 1.2;
    ctx.setLineDash(m.pending ? [2, 3] : [3, 2]);
    ctx.globalAlpha = m.pending ? 0.55 : 1;
    ctx.strokeRect(x0, top, x1 - x0, bot - top);
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  if (fireI >= 0) {
    const b = slice[fireI]!;
    const x = xAt(fireI);
    ctx.strokeStyle = WAIT;
    ctx.lineWidth = 1.4;
    ctx.strokeRect(x - bw * 0.48, y(b.high) - 3, bw * 0.96, y(b.low) - y(b.high) + 6);
  }

  const labeled = new Set<number>();
  const recent = marks.filter((m) => m.i >= slice.length - 10 && m.kind !== "amd");
  for (const m of recent) {
    if (labeled.has(m.i) && (m.span ?? 1) < 2) continue;
    const b = slice[m.i]!;
    const above = m.lean !== "UP";
    let ly = above ? y(b.high) - 2 : Math.min(h - 2, y(b.low) + 12);
    if (ly < 16) ly = Math.min(h - 2, y(b.low) + 12);
    const x = Math.min(w - 18, Math.max(18, xAt(m.i)));
    const tag = m.pending
      ? `?${MARK_LABEL[m.kind]}`
      : m.confirmed && m.contextOk
        ? MARK_LABEL[m.kind]
        : `·${MARK_LABEL[m.kind]}`;
    const col = m.pending ? WAIT : m.confirmed && m.contextOk ? markColor(m.kind, m.lean) : FG;
    ctx.globalAlpha = m.pending ? 0.7 : m.contextOk ? 1 : 0.55;
    labelWick(ctx, tag, x, ly, col);
    ctx.globalAlpha = 1;
    labeled.add(m.i);
  }

  ctx.font = "9px ui-monospace, 'IBM Plex Mono', monospace";
  ctx.fillStyle = FG;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  const fire = skill === "SIT" ? "SIT" : `FIRE ${skill.replace("WICK.", "")}`;
  const amd = read.amd ? ` · ${read.amd.phase.slice(0, 5)}` : "";
  ctx.fillText(`loc ${location} · ${read.structure.trend}${amd} · ${fire}`, padX, 2);
}

function drawDrift(ctx: CanvasRenderingContext2D, w: number, h: number, snap: Snapshot) {
  const d = readDrift(snap);
  hist(ctx, w, h, [snap.ret5, snap.ret15, snap.ret30], (v) => (v >= 0 ? UP : DOWN));
  ctx.font = "9px ui-monospace, 'IBM Plex Mono', monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const labels = ["5m", "15m", "30m"];
  const vals = [snap.ret5, snap.ret15, snap.ret30];
  labels.forEach((lb, i) => {
    const x = 8 + ((i + 0.5) / 3) * (w - 16);
    ctx.fillStyle = FG;
    ctx.fillText(lb, x, 2);
    ctx.fillStyle = vals[i]! >= 0 ? UP : DOWN;
    ctx.fillText(`${(vals[i]! * 100).toFixed(2)}%`, x, 12);
  });
  ctx.textAlign = "left";
  ctx.fillStyle = WAIT;
  const tag = d.aligned ? "ALIGNED" : d.pullback ? "PULLBACK" : d.accel ? "ACCEL" : d.decay ? "DECAY" : "CHOP";
  ctx.fillText(`${tag} · ${d.trend} · RSI ${Math.round(d.rsi)}`, 8, h - 12);
}

function drawExhaust(ctx: CanvasRenderingContext2D, w: number, h: number, snap: Snapshot) {
  const xh = readExhaust(snap);
  const bars = snap.candles_5m.slice(-24);
  candles(ctx, w, h, bars, undefined, xh.flipped ? bars.length - 1 : undefined);
  ctx.font = "9px ui-monospace, 'IBM Plex Mono', monospace";
  ctx.fillStyle = FG;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  const side = xh.ret1h >= 0 ? "1h UP" : "1h DN";
  const tag = xh.climax ? "CLIMAX" : xh.failedPush ? "FAIL PUSH" : xh.flipped ? "FLIP" : xh.inside ? "INSIDE" : "WATCH";
  ctx.fillText(`${side} ${xh.ret1h >= 0 ? "+" : ""}${(xh.ret1h * 100).toFixed(2)}% · ${tag} · 5m ${xh.last5Name}`, 8, 2);
}

function FeatGrid({ feat }: { feat: [string, unknown][] }) {
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 border-t border-border px-2 py-1.5">
      {feat.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-2 font-mono text-micro">
          <span className="text-subtle">{k}</span>
          <span className="tabular text-fg">
            {typeof v === "boolean"
              ? v
                ? "yes"
                : "no"
              : typeof v === "number"
                ? Number.isInteger(v)
                  ? String(v)
                  : round(v, 4)
                : String(v)}
          </span>
        </div>
      ))}
    </div>
  );
}

export function Eyes({ seat, snap, vote }: { seat: SeatId; snap: Snapshot; vote: Vote }) {
  const frame = useDesk();
  const down = vote.health === "DOWN";
  const dep = `${snap.as_of}-${seat}-${vote.skill_used}`;
  const ref = useDraw((ctx, w, h) => {
    if (down) return;
    if (seat === "WICK") {
      drawWick(ctx, w, h, snap.candles_1m, vote.skill_used, snap.location);
    } else if (seat === "EXHAUST") {
      drawExhaust(ctx, w, h, snap);
    } else if (seat === "STRIKE") {
      candles(ctx, w, h, snap.candles_1m.slice(-40), snap.strike);
    } else if (seat === "DRIFT") {
      drawDrift(ctx, w, h, snap);
    } else if (seat === "PULSE") {
      const vols = snap.candles_1m.slice(-30).map((c) => c.volume);
      hist(ctx, w, h, vols, () => LINE);
    } else if (seat === "TAPE") {
      hist(ctx, w, h, snap.imbalance_hist, (v) => (v >= 0 ? UP : DOWN));
    } else if (seat === "ODDS" || seat === "FADE" || seat === "CHEAP") {
      spark(ctx, w, h, snap.yes_mid_path, WAIT, 50);
    } else if (seat === "VEL") {
      spark(ctx, w, h, snap.candles_1m.slice(-20).map((c) => c.close), LINE);
    } else if (seat === "CARRY") {
      spark(ctx, w, h, snap.funding_history, WAIT);
    } else if (seat === "CHAIN") {
      spark(ctx, w, h, snap.oi_history, LINE);
    } else if (seat === "VOLT") {
      spark(ctx, w, h, snap.candles_1m.slice(-30).map((c) => c.high - c.low), WAIT);
    } else if (seat === "WHALE") {
      hist(
        ctx,
        w,
        h,
        snap.candles_1m.slice(-24).map((c) => c.volume * (c.close >= c.open ? 1 : -1)),
        (v) => (v >= 0 ? UP : DOWN),
      );
    } else if (seat === "CASCADE") {
      hist(ctx, w, h, [snap.oi_delta_10m, snap.ret5 * 1e6, snap.vol_last], (v) => (v >= 0 ? UP : DOWN));
    } else if (seat === "WIRE") {
      spark(ctx, w, h, snap.fng_history.length ? snap.fng_history : [snap.fear_greed], WAIT, 50);
    } else if (seat === "STREAK") {
      const st = readStreak(snap);
      hist(
        ctx,
        w,
        h,
        st.chips.map((c) => (c === "UP" ? 1 : c === "DOWN" ? -1 : 0)),
        (v) => (v >= 0 ? UP : DOWN),
      );
    }
  }, dep);

  if (down) return <Empty text="NO PRINT — bot is silent" />;

  const feat = Object.entries(vote.features).slice(0, 8);

  if (seat === "WICK") {
    const read5 = readWick(snap.candles_5m);
    const read = readWick(
      snap.candles_1m.filter((c) => c.closed),
      read5.structure.trend,
    );
    const recent = read.marks.filter((m) => m.i >= read.slice.length - 20);
    const counts: Partial<Record<MarkKind, number>> = {};
    for (const m of recent) counts[m.kind] = (counts[m.kind] ?? 0) + 1;
    const live = [...read.marks].reverse().find((m) => m.lean !== "WAIT" && m.i >= read.slice.length - 6);
    const chipTone = (k: MarkKind) => {
      const m = recent.find((x) => x.kind === k);
      if (m?.pending) return "text-wait border-wait/40";
      if (m?.confirmed && m.contextOk && m.lean === "UP") return "text-up border-up/40";
      if (m?.confirmed && m.contextOk && m.lean === "DOWN") return "text-down border-down/40";
      return "text-muted border-border";
    };
    const book = frame.learner.pattern_book ?? {};
    const seeing = recent.filter((m) => m.lean !== "WAIT").map((m) => MARK_LABEL[m.kind]);
    const rows = ledgerRows(book, seeing);
    return (
      <div className="flex min-h-36 flex-col bg-surface-2">
        <canvas ref={ref} className="h-40 w-full" />
        <div className="flex flex-wrap items-center gap-1 border-t border-border px-2 py-1">
          <span className="font-mono text-micro uppercase tracking-wider text-subtle">seeing</span>
          {read.amd && (
            <Tip k="chip.AMD" mark={false}>
              <span className="rounded-sm border border-chip/40 px-1 font-mono text-micro text-chip">
                AMD {read.amd.phase.slice(0, 5)}
              </span>
            </Tip>
          )}
          {(Object.keys(counts) as MarkKind[]).map((k) => {
            const n = counts[k] ?? 0;
            if (!n || k === "amd") return null;
            const m = recent.find((x) => x.kind === k);
            const tag = m?.pending ? "PEND" : m?.confirmed && m.contextOk ? "CFM" : "CTX";
            return (
              <span key={k} className={`rounded-sm border px-1 font-mono text-micro ${chipTone(k)}`}>
                <Tip k={`mark.${MARK_LABEL[k]}`} mark={false}>
                  {MARK_LABEL[k]} {n}
                </Tip>{" "}
                <Tip k={`chip.${tag}`} mark={false}>
                  {tag}
                </Tip>
              </span>
            );
          })}
          {!recent.length && !read.amd && (
            <span className="font-mono text-micro text-muted">no print this 20</span>
          )}
          <span className="ml-auto font-mono text-micro text-muted">
            {live
              ? `${MARK_LABEL[live.kind]} ${live.pending ? "PEND" : live.confirmed ? "CFM" : "NO"} · c ${round(live.confluence, 2)}`
              : read.lastName}{" "}
            · RSI {Math.round(read.rsi)} · {read.structure.trend} · 5m {read5.structure.trend}
          </span>
        </div>
        {rows.some((r) => r.n > 0) && (
          <div className="overflow-x-auto border-t border-border">
            <table className="w-full text-left">
              <thead className="font-mono text-micro uppercase tracking-wider text-subtle">
                <tr>
                  {(["kind", "n", "hit", "W%", "EV¢", "trust"] as const).map((h) => (
                    <th key={h} className="px-2 py-0.5 font-medium">
                      {h === "W%" ? (
                        <Tip k="set.wilson">W%</Tip>
                      ) : h === "EV¢" ? (
                        <Tip k="set.ev">EV¢</Tip>
                      ) : h === "trust" ? (
                        <Tip k="set.trust">trust</Tip>
                      ) : (
                        h
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows
                  .filter((r) => r.n > 0 || seeing.includes(r.kind))
                  .slice(0, 8)
                  .map((r) => (
                    <tr key={r.kind} className="border-t border-border/60">
                      <td className="px-2 py-0.5 font-mono text-micro text-fg">{r.kind}</td>
                      <td className="px-2 py-0.5 font-mono text-micro tabular text-muted">{r.n}</td>
                      <td className="px-2 py-0.5 font-mono text-micro tabular text-muted">{r.hits}</td>
                      <td className="px-2 py-0.5 font-mono text-micro tabular text-fg">
                        {r.n ? Math.round(r.wilson * 100) : "—"}
                      </td>
                      <td className="px-2 py-0.5 font-mono text-micro tabular text-fg">
                        {r.ev_n ? r.ev.toFixed(1) : "—"}
                      </td>
                      <td
                        className={`px-2 py-0.5 font-mono text-micro ${
                          r.trust.fold ? "text-down" : r.trust.uncalibrated ? "text-wait" : "text-up"
                        }`}
                      >
                        {r.trust.label}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
        <FeatGrid feat={feat} />
      </div>
    );
  }

  if (seat === "DRIFT") {
    const d = readDrift(snap);
    const chips: [string, boolean, "up" | "down" | "wait"][] = [
      ["ALIGNED", d.aligned, d.lean === "DOWN" ? "down" : "up"],
      ["ACCEL", d.accel, "up"],
      ["DECAY", d.decay, "wait"],
      ["PULLBACK", d.pullback, d.sign15 === "DOWN" ? "down" : "up"],
      ["STACK", d.stack, d.ema1mBull ? "up" : "down"],
      ["CHOP", d.chop, "wait"],
    ];
    return (
      <div className="flex min-h-36 flex-col bg-surface-2">
        <canvas ref={ref} className="h-36 w-full" />
        <div className="flex flex-wrap items-center gap-1 border-t border-border px-2 py-1">
          <span className="font-mono text-micro uppercase tracking-wider text-subtle">seeing</span>
          {chips.map(([k, on, tone]) =>
            on ? (
              <Tip key={k} k={`chip.${k}`} mark={false}>
                <span
                  className={`rounded-sm border px-1 font-mono text-micro ${
                    tone === "up"
                      ? "text-up border-up/40"
                      : tone === "down"
                        ? "text-down border-down/40"
                        : "text-wait border-wait/40"
                  }`}
                >
                  {k}
                </span>
              </Tip>
            ) : null,
          )}
          <span className="ml-auto font-mono text-micro text-muted">
            {d.trend} · RSI {Math.round(d.rsi)} · 1m {d.ema1mBull ? "EMA↑" : "EMA↓"} · 5m{" "}
            {d.ema5mBull ? "EMA↑" : "EMA↓"}
          </span>
        </div>
        <FeatGrid feat={feat} />
      </div>
    );
  }

  if (seat === "EXHAUST") {
    const xh = readExhaust(snap);
    const chips: [string, boolean][] = [
      ["RUN", xh.run],
      ["EXTREME", xh.extreme],
      ["FLIP", xh.flipped],
      ["CLIMAX", xh.climax],
      ["RSI DIV", xh.rsiDiv],
      ["FAIL PUSH", xh.failedPush],
      ["EMA X", xh.emaAgainst],
      ["INSIDE", xh.inside],
    ];
    return (
      <div className="flex min-h-36 flex-col bg-surface-2">
        <canvas ref={ref} className="h-36 w-full" />
        <div className="flex flex-wrap items-center gap-1 border-t border-border px-2 py-1">
          <span className="font-mono text-micro uppercase tracking-wider text-subtle">seeing</span>
          {chips.map(([k, on]) =>
            on ? (
              <Tip key={k} k={`chip.${k}`} mark={false}>
                <span className="rounded-sm border border-wait/40 px-1 font-mono text-micro text-wait">
                  {k}
                </span>
              </Tip>
            ) : null,
          )}
        </div>
        <FeatGrid feat={feat} />
      </div>
    );
  }

  return (
    <div className="flex min-h-36 flex-col bg-surface-2">
      <canvas ref={ref} className="h-36 w-full" />
      <div className="flex items-center gap-2 border-t border-border px-2 py-1 font-mono text-micro text-muted">
        <HealthDot h={vote.health} />
        <span>{vote.eyes || seat}</span>
      </div>
      <FeatGrid feat={feat} />
    </div>
  );
}
