import { SIGNAL_VERSION, AUTHORITY, MINUTE, signalV1 } from "./signal-v1.ts";
import { snapshot, savePrint, applySignal, type LabSql, type Snapshot } from "./sql.ts";
export const TICKER_URL = "https://api.exchange.coinbase.com/products/BTC-USD/ticker";
let timer: ReturnType<typeof setTimeout> | undefined;
let running = false;
let abort: AbortController | undefined;
let lastMinute: number | null = null;
let lastError: string | null = null;
let lastTick: number | null = null;
async function database(): Promise<LabSql> {
  const { getSql } = await import("@/lib/db");
  return getSql();
}
export async function publicTicker(request: typeof fetch = fetch): Promise<{ price: number; ts: number }> {
  const controller = new AbortController();
  abort = controller;
  const deadline = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await request(TICKER_URL, { method: "GET", redirect: "error", signal: controller.signal });
    if (!response.ok || response.redirected) { await response.body?.cancel(); throw new Error("public ticker unavailable"); }
    if (!response.body) throw new Error("empty public ticker");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 16384) throw new Error("public ticker too large");
        chunks.push(value);
      }
    } finally { await reader.cancel(); }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const data = JSON.parse(new TextDecoder().decode(bytes));
    const price = Number(data.price);
    const ts = typeof data.time === "string" ? Date.parse(data.time) : NaN;
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(ts)) throw new Error("invalid public ticker print");
    return { price, ts };
  } finally { clearTimeout(deadline); if (abort === controller) abort = undefined; }
}
function inputs(state: Snapshot, tickTs: number, newMinute: boolean) {
  const latest = state.trades.at(-1);
  return { prices: state.prices, decisionTs: Math.floor(tickTs / MINUTE) * MINUTE, tickTs, versionStatus: state.version.status,
    open: latest?.status === "open" ? { id: latest.id, side: latest.side, entryTs: latest.entryTs, entryPrice: latest.entryPrice } : null,
    lastEventTs: latest ? Math.max(latest.entryTs, latest.exitTs ?? latest.entryTs) : null, newMinute };
}
export async function paperTick(sql: LabSql, tickTs: number, newMinute: boolean): Promise<boolean> {
  const decisionTs = Math.floor(tickTs / MINUTE) * MINUTE;
  const state = await snapshot(sql, decisionTs);
  const signal = signalV1(inputs(state, tickTs, newMinute));
  const closedCount = state.trades.filter(row => row.status === "closed").length;
  if (signal.action === "hold" && closedCount === state.version.nClosed) return true;
  return applySignal(sql, state, signal, decisionTs, tickTs);
}
async function tick() {
  let print: { price: number; ts: number } | null = null;
  let feedFailed = false;
  try { print = await publicTicker(); }
  catch { feedFailed = true; lastError = "Public ticker unavailable; using only stored closed prints."; }
  try {
    const tickTs = Date.now();
    if (print && print.ts > tickTs) {
      print = null; feedFailed = true; lastError = "Invalid future ticker print; using only stored closed prints.";
    }
    const sql = await database();
    if (print) await savePrint(sql, print.price, print.ts, tickTs);
    const minute = Math.floor(tickTs / MINUTE) * MINUTE;
    const applied = await paperTick(sql, tickTs, lastMinute === null || minute > lastMinute);
    if (applied) lastMinute = minute;
    lastTick = tickTs;
    if (!feedFailed) lastError = null;
  } catch { lastError = "Storage or paper calculation unavailable; no confirmed mutation."; }
}
export function startSpotLab(): () => void {
  if (process.env.SPOT_LAB !== "1" || running) return () => {};
  running = true;
  const loop = async () => {
    try { await tick(); } catch { lastError = "Paper poll failed; retrying independently."; }
    if (running) { timer = setTimeout(() => void loop(), 15000); timer.unref?.(); }
  };
  void loop();
  return () => { running = false; if (timer) clearTimeout(timer); abort?.abort(); timer = undefined; };
}
export async function spotReport(tickTs = Date.now(), sql?: LabSql) {
  try {
    const state = await snapshot(sql ?? await database(), Math.floor(tickTs / MINUTE) * MINUTE);
    return { ok: true as const, authority: AUTHORITY, signalVersion: SIGNAL_VERSION, state, gate: signalV1(inputs(state, tickTs, true)), pollerEnabled: process.env.SPOT_LAB === "1", lastTick, lastError };
  } catch {
    return { ok: false as const, authority: AUTHORITY, signalVersion: SIGNAL_VERSION, error: "Storage unavailable", pollerEnabled: process.env.SPOT_LAB === "1", lastTick, lastError };
  }
}
