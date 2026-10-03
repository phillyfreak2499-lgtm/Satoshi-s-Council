import { SIGNAL_VERSION, type Side, type ExitReason } from "./signal-v1.ts";
export const HAIRCUT = 0.0010;
export interface PaperTrade {
  id: string;
  signalVersion: string;
  side: Side;
  entryTs: number;
  entryPrice: number;
  exitTs: number | null;
  exitPrice: number | null;
  exitReason: ExitReason | null;
  gross: number | null;
  pnlPaper: number | null;
  status: "open" | "closed";
}
export function paperReturn(side: Side, entry: number, exit: number) {
  if (![entry, exit].every(price => Number.isFinite(price) && price > 0) || !["long", "short"].includes(side)) throw new Error("invalid paper prices or side");
  const gross = (side === "long" ? 1 : -1) * (exit - entry) / entry;
  if (!Number.isFinite(gross)) throw new Error("non-finite paper return");
  return { gross, pnlPaper: gross - HAIRCUT };
}
export function closedV1(trades: PaperTrade[]): PaperTrade[] {
  return trades.filter(row => row.signalVersion === SIGNAL_VERSION && row.status === "closed").sort((a, b) => a.exitTs! - b.exitTs! || (BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0));
}
export function killCheckpoint(trades: PaperTrade[]) {
  const closed = closedV1(trades);
  const sum = closed.reduce((total, row) => total + row.pnlPaper!, 0);
  if (closed.length < 50) return { evaluated: false, killed: false, reason: null, nClosed: closed.length, pnlPaper: sum, bhPnl: null };
  const first50 = closed.slice(0, 50);
  const pnlPaper = first50.reduce((total, row) => total + row.pnlPaper!, 0);
  const firstEntry = first50.slice().sort((a, b) => a.entryTs - b.entryTs || (BigInt(a.id) < BigInt(b.id) ? -1 : 1))[0].entryPrice;
  const bhPnl = (first50[49].exitPrice! - firstEntry) / firstEntry - HAIRCUT;
  if (![pnlPaper, bhPnl].every(Number.isFinite)) throw new Error("invalid closed paper accounting");
  const nonpositive = pnlPaper <= 0;
  const trails = pnlPaper < bhPnl;
  const reason = nonpositive && trails ? "net_nonpositive_and_trails_buy_hold" : nonpositive ? "net_nonpositive" : trails ? "trails_buy_hold" : null;
  return { evaluated: true, killed: nonpositive || trails, reason, nClosed: 50, pnlPaper, bhPnl };
}
