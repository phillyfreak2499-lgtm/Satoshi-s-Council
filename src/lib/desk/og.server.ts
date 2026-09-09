/**
 * Share cards drawn on the server with no outside service and no image
 * library: a tiny RGB raster, a 5×7 pixel font, and a PNG encoder on top of
 * node's zlib. 1200×630, the size every link preview expects. Pure functions,
 * so the harness can check the bytes.
 */
import { deflateSync } from "node:zlib";

export type RGB = readonly [number, number, number];
export type Raster = { w: number; h: number; px: Uint8Array };

export const INK = {
  bg: [8, 9, 11] as RGB,
  surface: [18, 20, 24] as RGB,
  border: [44, 48, 56] as RGB,
  fg: [232, 230, 227] as RGB,
  muted: [150, 154, 162] as RGB,
  subtle: [104, 108, 116] as RGB,
  up: [61, 207, 138] as RGB,
  down: [239, 107, 115] as RGB,
  gold: [217, 164, 65] as RGB,
};

export function raster(w: number, h: number, bg: RGB = INK.bg): Raster {
  const px = new Uint8Array(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    px[i * 3] = bg[0];
    px[i * 3 + 1] = bg[1];
    px[i * 3 + 2] = bg[2];
  }
  return { w, h, px };
}

export function fillRect(r: Raster, x: number, y: number, w: number, h: number, c: RGB): void {
  const x0 = Math.max(0, Math.round(x));
  const y0 = Math.max(0, Math.round(y));
  const x1 = Math.min(r.w, Math.round(x + w));
  const y1 = Math.min(r.h, Math.round(y + h));
  for (let yy = y0; yy < y1; yy++) {
    let i = (yy * r.w + x0) * 3;
    for (let xx = x0; xx < x1; xx++) {
      r.px[i] = c[0];
      r.px[i + 1] = c[1];
      r.px[i + 2] = c[2];
      i += 3;
    }
  }
}

/** A blend toward a colour, for faint fills. */
export function tintRect(r: Raster, x: number, y: number, w: number, h: number, c: RGB, alpha: number): void {
  const x0 = Math.max(0, Math.round(x));
  const y0 = Math.max(0, Math.round(y));
  const x1 = Math.min(r.w, Math.round(x + w));
  const y1 = Math.min(r.h, Math.round(y + h));
  for (let yy = y0; yy < y1; yy++) {
    let i = (yy * r.w + x0) * 3;
    for (let xx = x0; xx < x1; xx++) {
      r.px[i] = Math.round(r.px[i]! + (c[0] - r.px[i]!) * alpha);
      r.px[i + 1] = Math.round(r.px[i + 1]! + (c[1] - r.px[i + 1]!) * alpha);
      r.px[i + 2] = Math.round(r.px[i + 2]! + (c[2] - r.px[i + 2]!) * alpha);
      i += 3;
    }
  }
}

export function line(r: Raster, x0: number, y0: number, x1: number, y1: number, c: RGB, thick = 2): void {
  let ax = Math.round(x0);
  let ay = Math.round(y0);
  const bx = Math.round(x1);
  const by = Math.round(y1);
  const dx = Math.abs(bx - ax);
  const dy = -Math.abs(by - ay);
  const sx = ax < bx ? 1 : -1;
  const sy = ay < by ? 1 : -1;
  let err = dx + dy;
  const half = Math.floor(thick / 2);
  for (;;) {
    fillRect(r, ax - half, ay - half, thick, thick, c);
    if (ax === bx && ay === by) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      ax += sx;
    }
    if (e2 <= dx) {
      err += dx;
      ay += sy;
    }
  }
}

// 5×7 glyphs. Lowercase is drawn as uppercase; unknown characters leave a gap.
const G: Record<string, string[]> = {
  A: [".XXX.", "X...X", "X...X", "XXXXX", "X...X", "X...X", "X...X"],
  B: ["XXXX.", "X...X", "X...X", "XXXX.", "X...X", "X...X", "XXXX."],
  C: [".XXXX", "X....", "X....", "X....", "X....", "X....", ".XXXX"],
  D: ["XXXX.", "X...X", "X...X", "X...X", "X...X", "X...X", "XXXX."],
  E: ["XXXXX", "X....", "X....", "XXXX.", "X....", "X....", "XXXXX"],
  F: ["XXXXX", "X....", "X....", "XXXX.", "X....", "X....", "X...."],
  G: [".XXXX", "X....", "X....", "X.XXX", "X...X", "X...X", ".XXXX"],
  H: ["X...X", "X...X", "X...X", "XXXXX", "X...X", "X...X", "X...X"],
  I: ["XXXXX", "..X..", "..X..", "..X..", "..X..", "..X..", "XXXXX"],
  J: ["....X", "....X", "....X", "....X", "X...X", "X...X", ".XXX."],
  K: ["X...X", "X..X.", "X.X..", "XX...", "X.X..", "X..X.", "X...X"],
  L: ["X....", "X....", "X....", "X....", "X....", "X....", "XXXXX"],
  M: ["X...X", "XX.XX", "X.X.X", "X.X.X", "X...X", "X...X", "X...X"],
  N: ["X...X", "XX..X", "X.X.X", "X..XX", "X...X", "X...X", "X...X"],
  O: [".XXX.", "X...X", "X...X", "X...X", "X...X", "X...X", ".XXX."],
  P: ["XXXX.", "X...X", "X...X", "XXXX.", "X....", "X....", "X...."],
  Q: [".XXX.", "X...X", "X...X", "X...X", "X.X.X", "X..X.", ".XX.X"],
  R: ["XXXX.", "X...X", "X...X", "XXXX.", "X.X..", "X..X.", "X...X"],
  S: [".XXXX", "X....", "X....", ".XXX.", "....X", "....X", "XXXX."],
  T: ["XXXXX", "..X..", "..X..", "..X..", "..X..", "..X..", "..X.."],
  U: ["X...X", "X...X", "X...X", "X...X", "X...X", "X...X", ".XXX."],
  V: ["X...X", "X...X", "X...X", "X...X", "X...X", ".X.X.", "..X.."],
  W: ["X...X", "X...X", "X...X", "X.X.X", "X.X.X", "XX.XX", "X...X"],
  X: ["X...X", "X...X", ".X.X.", "..X..", ".X.X.", "X...X", "X...X"],
  Y: ["X...X", "X...X", ".X.X.", "..X..", "..X..", "..X..", "..X.."],
  Z: ["XXXXX", "....X", "...X.", "..X..", ".X...", "X....", "XXXXX"],
  "0": [".XXX.", "X...X", "X..XX", "X.X.X", "XX..X", "X...X", ".XXX."],
  "1": ["..X..", ".XX..", "..X..", "..X..", "..X..", "..X..", ".XXX."],
  "2": [".XXX.", "X...X", "....X", "...X.", "..X..", ".X...", "XXXXX"],
  "3": ["XXXXX", "...X.", "..X..", "...X.", "....X", "X...X", ".XXX."],
  "4": ["...X.", "..XX.", ".X.X.", "X..X.", "XXXXX", "...X.", "...X."],
  "5": ["XXXXX", "X....", "XXXX.", "....X", "....X", "X...X", ".XXX."],
  "6": ["..XXX", ".X...", "X....", "XXXX.", "X...X", "X...X", ".XXX."],
  "7": ["XXXXX", "....X", "...X.", "..X..", ".X...", ".X...", ".X..."],
  "8": [".XXX.", "X...X", "X...X", ".XXX.", "X...X", "X...X", ".XXX."],
  "9": [".XXX.", "X...X", "X...X", ".XXXX", "....X", "...X.", "XXX.."],
  " ": [".....", ".....", ".....", ".....", ".....", ".....", "....."],
  ".": [".....", ".....", ".....", ".....", ".....", ".XX..", ".XX.."],
  ",": [".....", ".....", ".....", ".....", "..XX.", "..XX.", ".X..."],
  ":": [".....", ".XX..", ".XX..", ".....", ".XX..", ".XX..", "....."],
  "+": [".....", "..X..", "..X..", "XXXXX", "..X..", "..X..", "....."],
  "-": [".....", ".....", ".....", "XXXXX", ".....", ".....", "....."],
  "/": ["....X", "...X.", "...X.", "..X..", ".X...", ".X...", "X...."],
  "(": ["..X..", ".X...", ".X...", ".X...", ".X...", ".X...", "..X.."],
  ")": ["..X..", "...X.", "...X.", "...X.", "...X.", "...X.", "..X.."],
  "'": [".XX..", ".XX..", ".X...", ".....", ".....", ".....", "....."],
  "·": [".....", ".....", ".....", ".XX..", ".XX..", ".....", "....."],
  "%": ["XX..X", "XX.X.", "...X.", "..X..", ".X...", "X.XX.", "X..XX"],
  "¢": ["..X..", ".XXXX", "X.X..", "X.X..", "X.X..", ".XXXX", "..X.."],
  "→": [".....", "..X..", "...X.", "XXXXX", "...X.", "..X..", "....."],
  "&": [".XX..", "X..X.", "X.X..", ".X...", "X.X.X", "X..X.", ".XX.X"],
  "!": ["..X..", "..X..", "..X..", "..X..", "..X..", ".....", "..X.."],
  "?": [".XXX.", "X...X", "....X", "...X.", "..X..", ".....", "..X.."],
};

export function textWidth(s: string, scale: number): number {
  return s.length * 6 * scale - scale;
}

/** Draw a string at (x, y) with the pixel font; returns the x after the last glyph. */
export function text(r: Raster, x: number, y: number, s: string, c: RGB, scale = 5): number {
  let cx = Math.round(x);
  for (const raw of s.toUpperCase()) {
    const g = G[raw];
    if (g) {
      for (let row = 0; row < 7; row++) {
        const bits = g[row]!;
        for (let col = 0; col < 5; col++) {
          if (bits[col] === "X") fillRect(r, cx + col * scale, y + row * scale, scale, scale, c);
        }
      }
    }
    cx += 6 * scale;
  }
  return cx;
}

/** Draw a string so it fits the width, dropping the scale until it does. */
export function fitText(r: Raster, x: number, y: number, s: string, c: RGB, scale: number, maxW: number): number {
  let sc = scale;
  while (sc > 2 && textWidth(s, sc) > maxW) sc -= 1;
  return text(r, x, y, s, c, sc);
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), Buffer.from(data)]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

export function encodePng(r: Raster): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(r.w, 0);
  ihdr.writeUInt32BE(r.h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const stride = r.w * 3;
  const raw = Buffer.alloc((stride + 1) * r.h);
  for (let y = 0; y < r.h; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    raw.set(r.px.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 6 })),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

const W = 1200;
const H = 630;

function price(n: number | null | undefined, d = 0): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

function cents(n: number, signed = false): string {
  const s = signed && n > 0 ? "+" : "";
  return `${s}${n.toFixed(0)}¢`;
}

function frame(r: Raster, footer: string): void {
  fillRect(r, 0, 0, W, 6, INK.gold);
  text(r, 48, 34, "SATOSHI'S COUNCIL", INK.fg, 5);
  text(r, 48 + textWidth("SATOSHI'S COUNCIL ", 5), 34, "· PAPER ONLY · NOT ADVICE", INK.subtle, 5);
  fillRect(r, 48, H - 70, W - 96, 2, INK.border);
  fitText(r, 48, H - 52, footer, INK.subtle, 4, W - 96);
}

export type WindowCardInput = {
  ticker: string;
  close_time: string;
  strike: number | null;
  winner: "UP" | "DOWN" | null;
  official: number | null;
  call: { entry: number; settle: number | null; ev: number | null } | null;
  cols: { spot: number[]; yes_ask: number[]; lean: number[] };
};

/** A window's card: the price against the strike, the YES ask, the chair's lean, and the result. */
export function windowCard(w: WindowCardInput): Buffer {
  const r = raster(W, H);
  const hhmm = new Date(w.close_time).toISOString().slice(11, 16);
  const tone = w.winner === "UP" ? INK.up : w.winner === "DOWN" ? INK.down : INK.muted;
  text(r, 48, 84, `WINDOW ${hhmm} UTC`, INK.fg, 8);
  const x2 = 48 + textWidth(`WINDOW ${hhmm} UTC `, 8);
  text(r, x2, 84, w.winner ?? "OPEN", tone, 8);
  fitText(r, 48, 150, `STRIKE ${price(w.strike)} · SETTLED ${price(w.official, 2)}`, INK.muted, 5, W - 96);

  const cx0 = 48;
  const cx1 = W - 48;
  const cy0 = 200;
  const cy1 = 500;
  fillRect(r, cx0, cy0, cx1 - cx0, cy1 - cy0, INK.surface);
  const spot = w.cols.spot.filter((v) => Number.isFinite(v));
  const n = w.cols.spot.length;
  if (n >= 2 && spot.length >= 2) {
    const vals = w.strike ? [...spot, w.strike] : spot;
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const pad = Math.max((hi - lo) * 0.12, 1);
    const y = (v: number) => cy1 - 10 - ((v - (lo - pad)) / (hi - lo + 2 * pad)) * (cy1 - cy0 - 20);
    const x = (i: number) => cx0 + (i / (n - 1)) * (cx1 - cx0);
    if (w.strike) {
      const sy = y(w.strike);
      for (let i = 0; i < n - 1; i++) {
        const a = w.cols.spot[i]!;
        const b = w.cols.spot[i + 1]!;
        if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
        const xa = x(i);
        const xb = x(i + 1);
        const ya = y((a + b) / 2);
        const top = Math.min(ya, sy);
        tintRect(r, xa, top, Math.max(1, xb - xa), Math.abs(sy - ya), (a + b) / 2 >= w.strike ? INK.up : INK.down, 0.28);
      }
      for (let xx = cx0; xx < cx1; xx += 14) fillRect(r, xx, sy - 1, 8, 2, INK.gold);
      text(r, cx1 - textWidth(`K ${price(w.strike)}`, 3) - 8, sy - 26, `K ${price(w.strike)}`, INK.gold, 3);
    }
    for (let i = 0; i < n - 1; i++) {
      const a = w.cols.spot[i]!;
      const b = w.cols.spot[i + 1]!;
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
      line(r, x(i), y(a), x(i + 1), y(b), INK.fg, 3);
    }
    // YES ask on its own 0–100¢ axis, drawn thin in gold
    const ya = (v: number) => cy1 - 10 - (Math.max(0, Math.min(100, v)) / 100) * (cy1 - cy0 - 20);
    for (let i = 0; i < n - 1; i++) {
      const a = w.cols.yes_ask[i];
      const b = w.cols.yes_ask[i + 1];
      if (a == null || b == null || !(a > 0) || !(b > 0)) continue;
      line(r, x(i), ya(a), x(i + 1), ya(b), INK.gold, 1);
    }
    // the chair's lean, a band under the chart
    for (let i = 0; i < n; i++) {
      const l = w.cols.lean[i] ?? 0;
      if (!l) continue;
      fillRect(r, x(i), cy1 + 8, Math.max(2, (cx1 - cx0) / n + 1), 10, l > 0 ? INK.up : INK.down);
    }
    text(r, cx0, cy1 + 24, "BTC", INK.fg, 3);
    text(r, cx0 + textWidth("BTC ", 3), cy1 + 24, "YES ASK", INK.gold, 3);
    text(r, cx0 + textWidth("BTC YES ASK ", 3), cy1 + 24, "CHAIR", INK.muted, 3);
  } else {
    text(r, cx0 + 24, cy0 + 130, "NO REPLAY FOR THIS WINDOW", INK.subtle, 5);
  }

  const footer = w.call
    ? `CHAIR BOOKED ${cents(w.call.entry)} → ${w.call.settle == null ? "OPEN" : cents(w.call.settle)} · ${w.call.ev == null ? "" : cents(w.call.ev, true)} AFTER FEES`
    : "CHAIR SAT OUT · NOTHING BOOKED";
  frame(r, footer);
  return encodePng(r);
}

export type SeatCardInput = {
  id: string;
  callsign: string;
  eyes: string;
  lean: "UP" | "DOWN" | "WAIT";
  confidence: number;
  skill: string;
  n: number;
  hits: number;
  wilson: number;
  avg: number | null;
  calls: number;
  recent: number[];
};

/** A seat's card: who it is, what it says now, and its graded record. */
export function seatCard(s: SeatCardInput): Buffer {
  const r = raster(W, H);
  text(r, 48, 84, s.id, INK.fg, 10);
  text(r, 48 + textWidth(`${s.id} `, 10), 100, `(${s.callsign})`, INK.muted, 6);
  fitText(r, 48, 170, s.eyes.toUpperCase(), INK.muted, 5, W - 96);
  const tone = s.lean === "UP" ? INK.up : s.lean === "DOWN" ? INK.down : INK.gold;
  fillRect(r, 48, 230, W - 96, 90, INK.surface);
  text(r, 72, 254, "NOW", INK.subtle, 4);
  text(r, 72, 280, s.lean, tone, 6);
  const afterLean = 72 + textWidth(`${s.lean} `, 6);
  fitText(r, afterLean, 286, `${s.lean === "WAIT" ? "" : `${s.confidence} CONF · `}${s.skill}`, INK.muted, 4, W - 96 - afterLean);
  text(r, 48, 350, "RECORD", INK.subtle, 4);
  const rate = s.n ? Math.round((100 * s.hits) / s.n) : 0;
  fitText(
    r,
    48,
    378,
    s.n ? `RIGHT ${s.hits}/${s.n} (${rate}%) · WILSON ${Math.round(s.wilson * 100)}% · AVG ${s.avg == null ? "—" : cents(s.avg, true)} · ${s.calls} CALLS` : "NO GRADED READS YET",
    INK.fg,
    5,
    W - 96,
  );
  text(r, 48, 440, "LAST 20", INK.subtle, 4);
  const cell = Math.floor((W - 96) / 20);
  for (let i = 0; i < 20; i++) {
    const v = s.recent[s.recent.length - 20 + i];
    const c = v == null ? INK.border : v > 0 ? INK.up : INK.down;
    fillRect(r, 48 + i * cell, 466, cell - 6, 40, c);
  }
  frame(r, "ONE SEAT OF TWENTY-ONE · GRADED ON KALSHI'S OFFICIAL SETTLEMENT · PAPER");
  return encodePng(r);
}
