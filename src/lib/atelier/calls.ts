import type { CallLogRow, Lean } from "@/lib/desk/types";

export type Stance = "hold" | "wait" | "up";

export type DeskCall = {
  stance: Stance;
  label: string;
  at: number;
};

export function isStance(v: string): v is Stance {
  return v === "hold" || v === "wait" || v === "up";
}

export function leanToStance(lean: Lean | null | undefined): Stance {
  if (lean === "UP") return "up";
  if (lean === "DOWN") return "hold";
  return "wait";
}

export function stanceWord(s: Stance) {
  return s === "hold" ? "Down" : s === "wait" ? "Wait" : "Up";
}

export function callOf(params: Record<string, string | number>): Stance {
  const v = String(params.call ?? params.stance ?? "wait");
  return isStance(v) ? v : "wait";
}

export function formatRemain(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

export function tapeFromLog(log: CallLogRow[], current: Stance, label: string): DeskCall[] {
  const rows: DeskCall[] = log.map((row) => ({
    stance: leanToStance(row.lean),
    label: row.ticker,
    at: row.t,
  }));
  const last = rows[rows.length - 1];
  if (!last || last.stance !== current || last.label !== label) {
    rows.push({ stance: current, label, at: Date.now() });
  }
  return rows.slice(-16);
}
