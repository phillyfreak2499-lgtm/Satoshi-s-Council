import type { SeatId, SeatTab } from "./types";

export type SeatMeta = {
  id: SeatId;
  callsign: string;
  tab: SeatTab;
  base: number;
  eyes: string;
  feed: "spot" | "kalshi" | "derivs" | "mixed" | "meta";
};

export const SEATS: SeatMeta[] = [
  { id: "WICK", callsign: "PIN", tab: "structure", base: 0.1, eyes: "1m/5m candles", feed: "spot" },
  { id: "DRIFT", callsign: "VEC", tab: "structure", base: 0.07, eyes: "ret 5/15/30", feed: "spot" },
  { id: "STREAK", callsign: "RUN", tab: "structure", base: 0.06, eyes: "settled chips", feed: "meta" },
  { id: "EXHAUST", callsign: "XH", tab: "structure", base: 0.09, eyes: "1h + 5m flip", feed: "spot" },
  { id: "PULSE", callsign: "VOL", tab: "tape", base: 0.07, eyes: "1m volume", feed: "spot" },
  { id: "TAPE", callsign: "FLW", tab: "tape", base: 0.06, eyes: "Kalshi book", feed: "kalshi" },
  { id: "WHALE", callsign: "SZ", tab: "tape", base: 0.08, eyes: "large prints", feed: "spot" },
  { id: "VEL", callsign: "LAG", tab: "tape", base: 0.1, eyes: "spot vs YES mid", feed: "mixed" },
  { id: "CARRY", callsign: "FR", tab: "derivs", base: 0.06, eyes: "funding + OI", feed: "derivs" },
  { id: "CHAIN", callsign: "OI", tab: "derivs", base: 0.06, eyes: "OI vs price", feed: "derivs" },
  { id: "CASCADE", callsign: "LQ", tab: "derivs", base: 0.07, eyes: "liq / PROXY", feed: "derivs" },
  { id: "VOLT", callsign: "ATR", tab: "derivs", base: 0.07, eyes: "ATR% regime", feed: "spot" },
  { id: "ODDS", callsign: "YES", tab: "book", base: 0.09, eyes: "YES¢ path", feed: "kalshi" },
  { id: "STRIKE", callsign: "K", tab: "book", base: 0.11, eyes: "spot vs strike", feed: "mixed" },
  { id: "CHEAP", callsign: "VAL", tab: "book", base: 0.1, eyes: "42/58¢ bands", feed: "kalshi" },
  { id: "FADE", callsign: "RIP", tab: "book", base: 0.12, eyes: "60s YES rip", feed: "kalshi" },
  { id: "ORBIT", callsign: "REG", tab: "context", base: 0.05, eyes: "regime tiles", feed: "meta" },
  { id: "CLOCK", callsign: "TOD", tab: "context", base: 0.07, eyes: "session clock", feed: "meta" },
  { id: "WIRE", callsign: "FNG", tab: "context", base: 0.04, eyes: "Fear & Greed", feed: "meta" },
  { id: "WARDEN", callsign: "GATE", tab: "context", base: 0, eyes: "feed health", feed: "meta" },
];

export const SEAT_BY_ID: Record<SeatId, SeatMeta> = Object.fromEntries(
  SEATS.map((s) => [s.id, s]),
) as Record<SeatId, SeatMeta>;

export const TAB_SEATS: Record<SeatTab, SeatId[]> = {
  structure: ["WICK", "DRIFT", "STREAK", "EXHAUST"],
  tape: ["PULSE", "TAPE", "WHALE", "VEL"],
  derivs: ["CARRY", "CHAIN", "CASCADE", "VOLT"],
  book: ["ODDS", "STRIKE", "CHEAP", "FADE"],
  context: ["ORBIT", "CLOCK", "WIRE", "WARDEN"],
};

export const FADE_FAMILY: SeatId[] = ["FADE", "EXHAUST", "CHEAP", "WIRE"];
export const STRUCTURE_FAMILY: SeatId[] = ["WICK", "DRIFT", "STREAK"];
export const TAPE_FAMILY: SeatId[] = ["PULSE", "TAPE", "WHALE", "VEL"];
export const DERIVS_FAMILY: SeatId[] = ["CARRY", "CHAIN", "CASCADE"];

export const CATEGORY_OF: Record<SeatId, SeatTab> = Object.fromEntries(
  SEATS.map((s) => [s.id, s.tab]),
) as Record<SeatId, SeatTab>;
