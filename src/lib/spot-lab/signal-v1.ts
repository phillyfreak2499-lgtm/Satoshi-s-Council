export const SIGNAL_VERSION = "spot-signal-v1";
export const AUTHORITY = "none";
export const MINUTE = 60_000;
export type Side = "long" | "short";
export type ExitReason = "opposite" | "max_hold" | "stale" | "killed_flatten";
export interface Print { ts: number; price: number }
export interface Position { id: string; side: Side; entryTs: number; entryPrice: number }
export interface SignalInput {
  prices: Print[];
  decisionTs: number;
  tickTs: number;
  versionStatus: "active" | "killed";
  open: Position | null;
  lastEventTs: number | null;
  newMinute: boolean;
}
export interface SignalResult {
  action: "enter" | "exit" | "hold";
  side: Side | null;
  price: number | null;
  exitReason: ExitReason | null;
  warmup: number;
  smaFast: number | null;
  smaSlow: number | null;
  roc15: number | null;
  ageSeconds: number | null;
  longGate: boolean;
  shortGate: boolean;
  fresh: boolean;
}

export function signalV1(input: SignalInput): SignalResult {
  const { decisionTs, tickTs, open } = input;
  if (!Number.isFinite(decisionTs) || !Number.isFinite(tickTs) || tickTs < decisionTs || decisionTs % MINUTE !== 0) throw new Error("invalid explicit clock");
  const unique = new Map<number, number>();
  for (const print of input.prices) {
    if (Number.isFinite(print.ts) && print.ts % MINUTE === 0 && print.ts + MINUTE <= decisionTs && Number.isFinite(print.price) && print.price > 0) unique.set(print.ts, print.price);
  }
  const closed = [...unique].map(([ts, price]) => ({ ts, price })).sort((a, b) => a.ts - b.ts);
  const latest = closed.at(-1);
  const tail: Print[] = [];
  for (let i = closed.length - 1; i >= 0 && tail.length < 60; i--) {
    if (tail.length && tail[0].ts - closed[i].ts !== MINUTE) break;
    tail.unshift(closed[i]);
  }
  const warm = tail.length === 60;
  const average = (size: number) => tail.slice(-size).reduce((sum, row) => sum + row.price, 0) / size;
  const fast = warm ? average(20) : null;
  const slow = warm ? average(60) : null;
  const roc = warm ? tail[59].price / tail[44].price - 1 : null;
  const age = latest ? (tickTs - latest.ts) / 1000 : null;
  const fresh = age !== null && age >= 0 && age <= 90;
  const longGate = warm && fast! > slow! && roc! > 0.0015;
  const shortGate = warm && fast! < slow! && roc! < -0.0015;
  const result: SignalResult = { action: "hold", side: open?.side ?? null, price: latest?.price ?? null, exitReason: null, warmup: tail.length, smaFast: fast, smaSlow: slow, roc15: roc, ageSeconds: age, longGate, shortGate, fresh };
  if (!latest) return result;
  const exit = (reason: ExitReason): SignalResult => ({ ...result, action: "exit", exitReason: reason });
  if (open) {
    if (input.versionStatus === "killed") return exit("killed_flatten");
    if (age! > 180) return exit("stale");
    if (decisionTs - open.entryTs >= 240 * MINUTE) return exit("max_hold");
    if (input.newMinute && fresh && (open.side === "long" ? shortGate : longGate)) return exit("opposite");
    return result;
  }
  if (input.versionStatus !== "active" || !input.newMinute || !fresh || (input.lastEventTs !== null && input.lastEventTs >= decisionTs)) return result;
  if (longGate || shortGate) return { ...result, action: "enter", side: longGate ? "long" : "short" };
  return result;
}
