import type { Candle, SeatId, Snapshot, Vote } from "@/lib/desk/types";
import { round } from "@/lib/desk/math";
import { MARK_LABEL, readWick, type MarkKind, type WickMark } from "@/lib/desk/patterns";
import { ledgerRows } from "@/lib/desk/ledger";
import { readDrift, readExhaust, readStreak } from "@/lib/desk/structure";
import { useDesk } from "@/lib/desk/store";
import { useSmooth } from "@/lib/desk/hooks";
import { usePulse } from "@/lib/desk/pulse";
import { HealthDot } from "./bits";
import { Tip } from "./Tip";
import { cn } from "@/lib/utils";
import { BG, DOWN, FG, FONT_SM, GRID, INK, LINE, UP, WAIT, fillRound, useDraw } from "./canvas";

function fmtPx(p: number) {
  const a = Math.abs(p);
  if (a >= 1000) return p.toFixed(0);
  if (a >= 100) return p.toFixed(1);
  if (a >= 1) return p.toFixed(2);
  return p.toFixed(4);
}

function lastPill(ctx: CanvasRenderingContext2D, w: number, y: number, text: string, color: string) {
  ctx.save();
  ctx.font = FONT_SM;
  const tw = ctx.measureText(text).width + 8;
  const x = w - tw - 3;
  const top = Math.max(2, Math.min(y - 7, ctx.canvas.clientHeight - 16));
  ctx.fillStyle = color;
  fillRound(ctx, x, top, tw, 14, 2);
  ctx.fillStyle = INK;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + tw / 2, top + 8);
  ctx.restore();
}

type Pane = {
  padL: number;
  padR: number;
  plotT: number;
  plotB: number;
  volT: number;
  volB: number;
  hi: number;
  lo: number;
  bw: number;
  y: (p: number) => number;
  xAt: (i: number) => number;
  w: number;
  h: number;
  withVol: boolean;
};

function layoutOhlc(
  w: number,
  h: number,
  bars: Candle[],
  extra: number[] = [],
  withVol = false,
  head = 0.06,
): Pane {
  const padL = 8;
  const padR = 50;
  const padT = 18;
  const padB = 6;
  const volH = withVol ? Math.round(h * 0.2) : 0;
  const gap = withVol ? 7 : 0;
  const plotB = h - padB - volH - gap;
  const plotT = padT;
  const rawHi = Math.max(...bars.map((b) => b.high), ...extra);
  const rawLo = Math.min(...bars.map((b) => b.low), ...extra);
  const pad = Math.max(1e-9, rawHi - rawLo) * head;
  const hi = rawHi + pad;
  const lo = rawLo - pad * 0.45;
  const span = Math.max(1e-9, hi - lo);
  const bw = (w - padL - padR) / Math.max(1, bars.length);
  const y = (p: number) => plotT + ((hi - p) / span) * (plotB - plotT);
  const xAt = (i: number) => padL + i * bw + bw * 0.5;
  return {
    padL,
    padR,
    plotT,
    plotB,
    volT: plotB + gap,
    volB: h - padB,
    hi,
    lo,
    bw,
    y,
    xAt,
    w,
    h,
    withVol,
  };
}

function paintPane(ctx: CanvasRenderingContext2D, pane: Pane, nGrid = 4) {
  const { w, h, plotT, plotB, padL, padR, hi, lo } = pane;
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = GRID;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 1; i < nGrid; i++) {
    const yy = plotT + ((plotB - plotT) * i) / nGrid;
    ctx.moveTo(padL, yy);
    ctx.lineTo(w - padR, yy);
  }
  ctx.stroke();
  ctx.font = FONT_SM;
  ctx.fillStyle = FG;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let i = 0; i <= nGrid; i++) {
    const t = i / nGrid;
    const p = hi - (hi - lo) * t;
    const yy = plotT + (plotB - plotT) * t;
    ctx.fillText(fmtPx(p), w - 4, yy);
  }
  if (pane.withVol) {
    ctx.strokeStyle = GRID;
    ctx.beginPath();
    ctx.moveTo(padL, pane.volT - 3);
    ctx.lineTo(w - padR, pane.volT - 3);
    ctx.stroke();
  }
}

function emaOf(xs: number[], n: number) {
  if (!xs.length) return [];
  const k = 2 / (n + 1);
  let e = xs[0]!;
  return xs.map((x) => (e = x * k + e * (1 - k)));
}

function drawVolume(ctx: CanvasRenderingContext2D, pane: Pane, bars: Candle[]) {
  if (!pane.withVol) return;
  const max = Math.max(...bars.map((b) => b.volume), 1e-9);
  const { padL, bw, volT, volB } = pane;
  const h = volB - volT;
  bars.forEach((b, i) => {
    const x = padL + i * bw;
    const bh = (b.volume / max) * h;
    ctx.fillStyle = b.close >= b.open ? `${UP}99` : `${DOWN}99`;
    ctx.fillRect(x + bw * 0.18, volB - bh, Math.max(1, bw * 0.64), Math.max(1, bh));
  });
}

function drawEma(ctx: CanvasRenderingContext2D, pane: Pane, bars: Candle[]) {
  const xs = emaOf(
    bars.map((b) => b.close),
    9,
  );
  if (xs.length < 2) return;
  ctx.save();
  ctx.strokeStyle = LINE;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 1.15;
  ctx.lineJoin = "round";
  ctx.beginPath();
  xs.forEach((v, i) => {
    const x = pane.xAt(i);
    const y = pane.y(v);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.restore();
}

function drawLastLine(ctx: CanvasRenderingContext2D, pane: Pane, px: number, color: string, tag?: string) {
  const y = pane.y(px);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(pane.padL, y);
  ctx.lineTo(pane.w - pane.padR, y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
  lastPill(ctx, pane.w, y, tag ?? fmtPx(px), color);
  ctx.restore();
}

function drawCandleBodies(
  ctx: CanvasRenderingContext2D,
  pane: Pane,
  bars: Candle[],
  styleAt?: (b: Candle, i: number) => { reject?: boolean; doji?: boolean; maru?: boolean },
) {
  const { y, xAt, bw } = pane;
  bars.forEach((b, i) => {
    const x = xAt(i);
    const up = b.close >= b.open;
    const st = styleAt?.(b, i);
    ctx.save();
    ctx.globalAlpha = b.closed ? 1 : 0.45;
    const col = st?.reject ? WAIT : up ? UP : DOWN;
    ctx.strokeStyle = col;
    ctx.fillStyle = up ? UP : DOWN;
    ctx.lineWidth = st?.reject ? 1.8 : 1;
    ctx.lineCap = "butt";
    ctx.beginPath();
    ctx.moveTo(x, y(b.high));
    ctx.lineTo(x, y(b.low));
    ctx.stroke();
    const top = y(Math.max(b.open, b.close));
    const bot = y(Math.min(b.open, b.close));
    const bh = Math.max(1, bot - top);
    const bodyW = Math.max(2, bw * 0.62);
    if (st?.doji || bh <= 1.2) {
      ctx.strokeStyle = st?.doji ? WAIT : col;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x - bodyW / 2, (top + bot) / 2);
      ctx.lineTo(x + bodyW / 2, (top + bot) / 2);
      ctx.stroke();
    } else {
      ctx.fillRect(x - bodyW / 2, top, bodyW, bh);
      if (st?.maru) {
        ctx.strokeStyle = LINE;
        ctx.lineWidth = 1;
        ctx.strokeRect(x - bodyW / 2, top, bodyW, bh);
      }
    }
    ctx.restore();
  });
}

function candles(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  bars: Snapshot["candles_1m"],
  strike?: number,
  mark?: number,
) {
  if (!bars.length) {
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, w, h);
    return;
  }
  const extra = strike != null ? [strike] : [];
  const pane = layoutOhlc(w, h, bars, extra, true, 0.05);
  paintPane(ctx, pane);
  drawVolume(ctx, pane, bars);
  if (mark != null && bars[mark]) {
    const x = pane.xAt(mark);
    ctx.fillStyle = `${WAIT}22`;
    ctx.fillRect(x - pane.bw * 0.5, pane.plotT, pane.bw, pane.plotB - pane.plotT);
  }
  drawCandleBodies(ctx, pane, bars);
  drawEma(ctx, pane, bars);
  const last = bars[bars.length - 1]!;
  drawLastLine(ctx, pane, last.close, last.close >= last.open ? UP : DOWN);
  if (strike != null) drawLastLine(ctx, pane, strike, WAIT, `K ${fmtPx(strike)}`);
}

function spark(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  xs: number[],
  color: string,
  mid?: number,
) {
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, w, h);
  if (xs.length < 2) return;
  const padL = 8;
  const padR = 50;
  const padT = 14;
  const padB = 10;
  const hi = Math.max(...xs, mid ?? -Infinity);
  const lo = Math.min(...xs, mid ?? Infinity);
  const span = Math.max(1e-9, hi - lo);
  const head = span * 0.08;
  const y = (p: number) => padT + ((hi + head - p) / (span + head * 2)) * (h - padT - padB);
  ctx.strokeStyle = GRID;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 1; i < 4; i++) {
    const yy = padT + ((h - padT - padB) * i) / 4;
    ctx.moveTo(padL, yy);
    ctx.lineTo(w - padR, yy);
  }
  ctx.stroke();
  ctx.font = FONT_SM;
  ctx.fillStyle = FG;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillText(fmtPx(hi), w - 4, y(hi));
  ctx.fillText(fmtPx(lo), w - 4, y(lo));
  if (mid != null) {
    ctx.strokeStyle = GRID;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(padL, y(mid));
    ctx.lineTo(w - padR, y(mid));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = FG;
    ctx.fillText(fmtPx(mid), w - 4, y(mid));
  }
  const pts = xs.map((v, i) => ({
    x: padL + (i / (xs.length - 1)) * (w - padL - padR),
    y: y(v),
  }));
  const last = pts[pts.length - 1]!;
  ctx.beginPath();
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.lineTo(last.x, h - padB);
  ctx.lineTo(pts[0]!.x, h - padB);
  ctx.closePath();
  const g = ctx.createLinearGradient(0, padT, 0, h - padB);
  g.addColorStop(0, `${color}3d`);
  g.addColorStop(1, `${color}00`);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.beginPath();
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.7;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(last.x, last.y, 2.6, 0, Math.PI * 2);
  ctx.fill();
  lastPill(ctx, w, last.y, fmtPx(xs[xs.length - 1]!), color);
}

function hist(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  xs: number[],
  colorFor: (v: number, i: number) => string,
  opts?: { from?: "mid" | "bottom"; labels?: string[] },
) {
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, w, h);
  if (!xs.length) return;
  const pad = 10;
  const padT = 16;
  const from = opts?.from ?? "mid";
  const max = Math.max(...xs.map(Math.abs), 1e-9);
  const bw = (w - pad * 2) / xs.length;
  const barW = Math.max(2, bw * 0.72);
  const mid = (h + padT - pad) / 2;
  if (from === "mid") {
    ctx.strokeStyle = GRID;
    ctx.beginPath();
    ctx.moveTo(pad, mid);
    ctx.lineTo(w - pad, mid);
    ctx.stroke();
  }
  xs.forEach((v, i) => {
    const x = pad + i * bw + (bw - barW) / 2;
    ctx.globalAlpha = 0.4 + 0.6 * (Math.abs(v) / max);
    ctx.fillStyle = colorFor(v, i);
    if (from === "bottom") {
      const bh = (Math.abs(v) / max) * (h - padT - pad);
      ctx.fillRect(x, h - pad - bh, barW, Math.max(1, bh));
    } else if (v >= 0) {
      const bh = (v / max) * (mid - padT);
      ctx.fillRect(x, mid - bh, barW, Math.max(1, bh));
    } else {
      const bh = (-v / max) * (h - pad - mid);
      ctx.fillRect(x, mid, barW, Math.max(1, bh));
    }
    ctx.globalAlpha = 1;
    if (opts?.labels?.[i]) {
      ctx.font = FONT_SM;
      ctx.fillStyle = FG;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(opts.labels[i]!, x + barW / 2, 3);
    }
  });
}

function ribbon(ctx: CanvasRenderingContext2D, w: number, h: number, chips: ("UP" | "DOWN" | "WAIT")[]) {
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, w, h);
  if (!chips.length) return;
  const pad = 10;
  const bw = (w - pad * 2) / chips.length;
  const top = 18;
  const bh = h - top - pad;
  chips.forEach((c, i) => {
    ctx.fillStyle = c === "UP" ? UP : c === "DOWN" ? DOWN : GRID;
    ctx.globalAlpha = c === "WAIT" ? 0.35 : 0.88;
    ctx.fillRect(pad + i * bw + 1, top, Math.max(2, bw - 2), bh);
  });
  ctx.globalAlpha = 1;
  ctx.font = FONT_SM;
  ctx.fillStyle = FG;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(`${chips.length} bars`, pad, 4);
}

function markColor(kind: MarkKind, lean: WickMark["lean"]): string {
  if (lean === "UP") return UP;
  if (lean === "DOWN") return DOWN;
  return WAIT;
}

function labelWick(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
  stemY?: number,
) {
  ctx.save();
  ctx.font = FONT_SM;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const tw = ctx.measureText(text).width + 8;
  const th = 12;
  const lx = x;
  const top = y - th;
  if (stemY != null) {
    ctx.strokeStyle = `${color}99`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, stemY);
    ctx.lineTo(x, y - (stemY < y ? th : 0));
    ctx.stroke();
  }
  ctx.fillStyle = INK;
  fillRound(ctx, lx - tw / 2, top, tw, th, 2);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(lx - tw / 2, top, tw, th, 2);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.fillText(text, lx, top + th / 2 + 0.5);
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
  if (!slice.length) {
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, w, h);
    return;
  }
  const locSlice = slice.slice(-20);
  const locHi = Math.max(...locSlice.map((b) => b.high));
  const locLo = Math.min(...locSlice.map((b) => b.low));
  const pane = layoutOhlc(w, h, slice, [locHi, locLo], true, 0.14);
  const { y, xAt, bw } = pane;
  paintPane(ctx, pane);

  const yHigh = y(locLo + 0.8 * (locHi - locLo));
  const yLow = y(locLo + 0.2 * (locHi - locLo));
  ctx.fillStyle = `${UP}0f`;
  ctx.fillRect(pane.padL, pane.plotT, w - pane.padL - pane.padR, Math.max(0, yHigh - pane.plotT));
  ctx.fillStyle = `${DOWN}0f`;
  ctx.fillRect(pane.padL, yLow, w - pane.padL - pane.padR, Math.max(0, pane.plotB - yLow));
  ctx.strokeStyle = GRID;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(pane.padL, yHigh);
  ctx.lineTo(w - pane.padR, yHigh);
  ctx.moveTo(pane.padL, yLow);
  ctx.lineTo(w - pane.padR, yLow);
  ctx.stroke();
  ctx.setLineDash([]);

  if (read.amd) {
    const { acc, manipI, distI, phase, lean } = read.amd;
    const x0 = xAt(acc.i0) - bw * 0.45;
    const x1 = xAt(acc.i1) + bw * 0.45;
    ctx.fillStyle = `${LINE}0f`;
    ctx.fillRect(x0, y(acc.hi), Math.max(2, x1 - x0), Math.max(2, y(acc.lo) - y(acc.hi)));
    ctx.strokeStyle = LINE;
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(x0, y(acc.hi), Math.max(2, x1 - x0), Math.max(2, y(acc.lo) - y(acc.hi)));
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    const tag = phase === "DISTRIBUTION" ? `AMD ${lean}` : phase === "MANIPULATION" ? "AMD MANIP" : "AMD ACC";
    labelWick(ctx, tag, x0 + 28, Math.max(16, y(acc.hi) - 2), phase === "DISTRIBUTION" ? markColor("amd", lean) : WAIT);
    if (manipI != null) {
      const b = slice[manipI]!;
      ctx.strokeStyle = WAIT;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(xAt(manipI), y(b.high));
      ctx.lineTo(xAt(manipI), y(b.low));
      ctx.stroke();
    }
    if (distI != null) {
      const b = slice[distI]!;
      ctx.fillStyle = `${lean === "UP" ? UP : DOWN}22`;
      ctx.fillRect(xAt(distI) - bw * 0.48, pane.plotT, bw * 0.96, pane.plotB - pane.plotT);
      ctx.strokeStyle = lean === "UP" ? UP : DOWN;
      ctx.lineWidth = 1.2;
      ctx.strokeRect(xAt(distI) - bw * 0.48, y(b.high) - 3, bw * 0.96, y(b.low) - y(b.high) + 6);
    }
  }

  for (const s of [...read.structure.highs, ...read.structure.lows].slice(-8)) {
    const isHi = read.structure.highs.includes(s);
    ctx.fillStyle = isHi ? DOWN : UP;
    ctx.beginPath();
    const sx = xAt(s.i);
    const sy = y(s.px);
    ctx.moveTo(sx, sy + (isHi ? -4 : 4));
    ctx.lineTo(sx - 3.2, sy);
    ctx.lineTo(sx + 3.2, sy);
    ctx.closePath();
    ctx.fill();
  }

  const lastClosed = [...slice].reverse().find((b) => b.closed) ?? slice[slice.length - 1]!;
  const fireI = slice.lastIndexOf(lastClosed);
  if (fireI >= 0) {
    ctx.fillStyle = `${WAIT}18`;
    ctx.fillRect(xAt(fireI) - bw * 0.5, pane.plotT, bw, pane.plotB - pane.plotT);
  }

  drawVolume(ctx, pane, slice);
  drawCandleBodies(ctx, pane, slice, (b, i) => {
    const kinds = marks.filter((m) => m.i === i).map((m) => m.kind);
    return {
      reject: kinds.some((k) =>
        ["pin", "hammer", "hanging", "inv_ham", "shoot", "dragonfly", "gravestone", "sweep-up", "sweep-dn"].includes(
          k,
        ),
      ),
      doji: kinds.some((k) => ["doji", "long_leg", "dragonfly", "gravestone"].includes(k)),
      maru: kinds.includes("marubozu"),
    };
  });
  drawEma(ctx, pane, slice);

  for (const m of marks) {
    if ((m.span ?? 1) < 2) continue;
    // only the latest multi-bar box — earlier ones just clutter
    if (m !== [...marks].reverse().find((x) => (x.span ?? 1) >= 2 && x.kind === m.kind)) continue;
    const i0 = Math.max(0, m.i - (m.span - 1));
    const prev = slice[i0]!;
    const bar = slice[m.i]!;
    const x0 = xAt(i0) - bw * 0.4;
    const x1 = xAt(m.i) + bw * 0.4;
    const top = Math.min(y(prev.high), y(bar.high)) - 3;
    const bot = Math.max(y(prev.low), y(bar.low)) + 3;
    ctx.strokeStyle = markColor(m.kind, m.lean);
    ctx.lineWidth = 1;
    ctx.setLineDash(m.pending ? [2, 3] : [4, 2]);
    ctx.globalAlpha = m.pending ? 0.45 : 0.7;
    ctx.strokeRect(x0, top, x1 - x0, bot - top);
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  const last = slice[slice.length - 1]!;
  drawLastLine(ctx, pane, last.close, last.close >= last.open ? UP : DOWN);

  type Lab = { x: number; y: number; text: string; color: string; stem: number; tw: number };
  const labs: Lab[] = [];
  ctx.font = FONT_SM;
  const recent = marks.filter((m) => m.i >= slice.length - 12 && m.kind !== "amd");
  const labeled = new Set<number>();
  const toLabel = [...recent].reverse().slice(0, 3);
  for (const m of recent) {
    const b = slice[m.i]!;
    const col = m.pending ? WAIT : m.confirmed && m.contextOk ? markColor(m.kind, m.lean) : FG;
    const above = m.lean !== "UP";
    const sx = xAt(m.i);
    const stem = above ? y(b.high) : y(b.low);
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(sx, stem + (above ? -1 : 1));
    ctx.lineTo(sx - 2.6, stem + (above ? -6 : 6));
    ctx.lineTo(sx + 2.6, stem + (above ? -6 : 6));
    ctx.closePath();
    ctx.fill();
  }
  for (const m of toLabel) {
    if (labeled.has(m.i)) continue;
    labeled.add(m.i);
    const b = slice[m.i]!;
    const tag = m.pending
      ? `?${MARK_LABEL[m.kind]}`
      : m.confirmed && m.contextOk
        ? MARK_LABEL[m.kind]
        : `·${MARK_LABEL[m.kind]}`;
    const col = m.pending ? WAIT : m.confirmed && m.contextOk ? markColor(m.kind, m.lean) : FG;
    const above = m.lean !== "UP";
    const stem = above ? y(b.high) : y(b.low);
    const ly = above ? Math.max(28, stem - 8) : Math.min(pane.plotB - 4, stem + 18);
    const x = Math.min(w - pane.padR - 10, Math.max(pane.padL + 10, xAt(m.i)));
    labs.push({ x, y: ly, text: tag, color: col, stem, tw: ctx.measureText(tag).width + 10 });
  }
  labs.sort((a, b) => a.x - b.x);
  for (let i = 1; i < labs.length; i++) {
    const prev = labs[i - 1]!;
    const cur = labs[i]!;
    const overlap = (prev.tw + cur.tw) / 2 + 4;
    if (Math.abs(cur.x - prev.x) < overlap && Math.abs(cur.y - prev.y) < 14) {
      cur.y = Math.min(pane.plotB - 4, prev.y + 13);
    }
  }
  for (const lab of labs) {
    ctx.globalAlpha = lab.text.startsWith("?") ? 0.75 : lab.text.startsWith("·") ? 0.55 : 1;
    labelWick(ctx, lab.text, lab.x, lab.y, lab.color, lab.stem);
    ctx.globalAlpha = 1;
  }

  ctx.font = FONT_SM;
  ctx.fillStyle = FG;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  const fire = skill === "SIT" ? "SIT" : `FIRE ${skill.replace("WICK.", "")}`;
  const amd = read.amd ? ` · ${read.amd.phase.slice(0, 5)}` : "";
  const cap = `loc ${location} · ${read.structure.trend}${amd} · ${fire}`;
  const capW = ctx.measureText(cap).width + 8;
  ctx.fillStyle = `${BG}e6`;
  fillRound(ctx, pane.padL - 2, 2, capW, 13, 2);
  ctx.fillStyle = FG;
  ctx.fillText(cap, pane.padL + 2, 4);
}

function drawDrift(ctx: CanvasRenderingContext2D, w: number, h: number, snap: Snapshot) {
  const d = readDrift(snap);
  const closes = snap.candles_1m.slice(-40).map((c) => c.close);
  spark(ctx, w, Math.round(h * 0.55), closes, d.trend === "DOWN" ? DOWN : UP);
  ctx.save();
  ctx.translate(0, Math.round(h * 0.55));
  hist(
    ctx,
    w,
    h - Math.round(h * 0.55),
    [snap.ret5, snap.ret15, snap.ret30],
    (v) => (v >= 0 ? UP : DOWN),
    { labels: ["5m", "15m", "30m"] },
  );
  ctx.restore();
  ctx.font = FONT_SM;
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  ctx.fillStyle = WAIT;
  const tag = d.aligned ? "ALIGNED" : d.pullback ? "PULLBACK" : d.accel ? "ACCEL" : d.decay ? "DECAY" : "CHOP";
  ctx.fillText(`${tag} · ${d.trend} · RSI ${Math.round(d.rsi)}`, 8, h - 3);
}

function drawExhaust(ctx: CanvasRenderingContext2D, w: number, h: number, snap: Snapshot) {
  const xh = readExhaust(snap);
  const bars = snap.candles_5m.slice(-24);
  candles(ctx, w, h, bars, undefined, xh.flipped ? bars.length - 1 : undefined);
  ctx.font = FONT_SM;
  ctx.fillStyle = FG;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  const side = xh.ret1h >= 0 ? "1h UP" : "1h DN";
  const tag = xh.climax ? "CLIMAX" : xh.failedPush ? "FAIL PUSH" : xh.flipped ? "FLIP" : xh.inside ? "INSIDE" : "WATCH";
  const cap = `${side} ${xh.ret1h >= 0 ? "+" : ""}${(xh.ret1h * 100).toFixed(2)}% · ${tag} · 5m ${xh.last5Name}`;
  const capW = ctx.measureText(cap).width + 8;
  ctx.fillStyle = `${BG}e6`;
  fillRound(ctx, 6, 2, capW, 13, 2);
  ctx.fillStyle = FG;
  ctx.fillText(cap, 10, 4);
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
      const bars = snap.candles_1m.slice(-30);
      hist(
        ctx,
        w,
        h,
        bars.map((c) => c.volume),
        (_v, i) => (bars[i]!.close >= bars[i]!.open ? UP : DOWN),
        { from: "bottom" },
      );
    } else if (seat === "TAPE") {
      hist(ctx, w, h, snap.imbalance_hist, (v) => (v >= 0 ? UP : DOWN));
    } else if (seat === "ODDS" || seat === "FADE" || seat === "CHEAP") {
      spark(ctx, w, h, snap.yes_mid_path, WAIT, 50);
    } else if (seat === "VEL") {
      spark(
        ctx,
        w,
        h,
        snap.candles_1m.slice(-30).map((c) => c.close),
        LINE,
      );
    } else if (seat === "CARRY") {
      spark(ctx, w, h, snap.funding_history, WAIT);
    } else if (seat === "CHAIN") {
      spark(ctx, w, h, snap.oi_history, LINE);
    } else if (seat === "VOLT") {
      spark(
        ctx,
        w,
        h,
        snap.candles_1m.slice(-30).map((c) => c.high - c.low),
        WAIT,
      );
    } else if (seat === "WHALE") {
      hist(
        ctx,
        w,
        h,
        snap.candles_1m.slice(-24).map((c) => c.volume * (c.close >= c.open ? 1 : -1)),
        (v) => (v >= 0 ? UP : DOWN),
      );
    } else if (seat === "CASCADE") {
      hist(
        ctx,
        w,
        h,
        [snap.oi_delta_10m, snap.ret5 * 1e6, snap.vol_last],
        (v) => (v >= 0 ? UP : DOWN),
        { labels: ["OI 10m", "ret5", "vol"] },
      );
    } else if (seat === "WIRE") {
      spark(ctx, w, h, snap.fng_history.length ? snap.fng_history : [snap.fear_greed], WAIT, 50);
    } else if (seat === "STREAK") {
      const st = readStreak(snap);
      const chips = st.chips.length
        ? st.chips
        : snap.candles_1m.slice(-24).map((c) => (c.close >= c.open ? "UP" : "DOWN"));
      ribbon(ctx, w, h, chips);
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
        <canvas ref={ref} className="block h-48 w-full" />
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
        <canvas ref={ref} className="block h-44 w-full" />
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
        <canvas ref={ref} className="block h-44 w-full" />
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
      <canvas ref={ref} className="block h-40 w-full" />
      <div className="flex items-center gap-2 border-t border-border px-2 py-1 font-mono text-micro text-muted">
        <HealthDot h={vote.health} />
        <span>{vote.eyes || seat}</span>
      </div>
      <FeatGrid feat={feat} />
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="flex h-40 items-center justify-center border border-dashed border-border bg-surface-2 font-mono text-ui text-muted">
      {text}
    </div>
  );
}

export function ChairEyes({ snap }: { snap: Snapshot }) {
  // Fast lane: between 4s frames, the headline charts track the 1.5s pulse
  // with a short tween. The tweened spot may only EXTEND the unclosed bar's
  // range, never contradict frame OHLC, and everything falls back to the
  // frame the moment the pulse is stale or belongs to another window.
  const pulse = usePulse();
  const live = pulse && pulse.spot != null && pulse.ticker === snap.ticker ? pulse : null;
  const s = useSmooth(live?.spot ?? snap.spot);
  const yesMidTarget =
    live && live.yes_bid > 0 && live.yes_ask > 0 ? (live.yes_bid + live.yes_ask) / 2 : snap.yes_mid;
  const ym = useSmooth(yesMidTarget);
  // Quantized dep: repaint on visible steps, not on every tween frame.
  const dep = `${snap.as_of}-${(Math.round(s * 2) / 2).toFixed(1)}-${ym.toFixed(1)}`;
  const spotRef = useDraw((ctx, w, h) => {
    const bars = snap.candles_1m.slice(-40);
    const lastBar = bars[bars.length - 1];
    if (lastBar && !lastBar.closed && Number.isFinite(s) && s > 0) {
      bars[bars.length - 1] = {
        ...lastBar,
        close: s,
        high: Math.max(lastBar.high, s),
        low: Math.min(lastBar.low, s),
      };
    }
    candles(ctx, w, h, bars, snap.strike);
  }, dep);
  const yesRef = useDraw((ctx, w, h) => {
    const base = snap.yes_mid_path.length >= 2 ? snap.yes_mid_path : [snap.yes_mid, snap.yes_mid];
    const path =
      Number.isFinite(ym) && ym > 0 ? [...base.slice(0, -1), ym] : base;
    spark(ctx, w, h, path, WAIT, 50);
  }, dep);
  const last = snap.candles_1m[snap.candles_1m.length - 1];
  const liveClose = last && !last.closed && Number.isFinite(s) && s > 0 ? s : last?.close;
  const ret1 =
    last && last.open && liveClose != null
      ? (((liveClose - last.open) / last.open) * 100).toFixed(2)
      : null;
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <section className="min-w-0 overflow-hidden rounded-md border border-border bg-surface-2">
        <div className="flex items-baseline justify-between gap-2 px-2 py-1.5">
          <h3 className="font-mono text-micro uppercase tracking-widest text-subtle">
            <Tip k="pane.spot-chart">BTC 15m</Tip>
          </h3>
          <span className="font-mono text-micro tabular text-muted">
            {ret1 != null ? `${Number(ret1) >= 0 ? "+" : ""}${ret1}% 1m` : "—"}
            {" · "}K {snap.strike.toFixed(0)}
          </span>
        </div>
        <canvas ref={spotRef} className="block h-40 w-full" />
      </section>
      <section className="min-w-0 overflow-hidden rounded-md border border-border bg-surface-2">
        <div className="flex items-baseline justify-between gap-2 px-2 py-1.5">
          <h3 className="font-mono text-micro uppercase tracking-widest text-subtle">
            <Tip k="pane.yes-chart">YES path</Tip>
          </h3>
          <span className={cn("font-mono text-micro tabular", yesMidTarget >= 50 ? "text-up" : "text-down")}>
            {ym.toFixed(1)}¢ mid · ask {(live && live.yes_ask > 0 ? live.yes_ask : snap.yes_ask).toFixed(1)}¢
          </span>
        </div>
        <canvas ref={yesRef} className="block h-40 w-full" />
      </section>
    </div>
  );
}
