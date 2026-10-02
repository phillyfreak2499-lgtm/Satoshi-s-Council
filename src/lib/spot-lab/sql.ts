import { SIGNAL_VERSION, MINUTE, type Print, type SignalResult } from "./signal-v1.ts";
import { closedV1, killCheckpoint, paperReturn, type PaperTrade } from "./ledger.ts";
export interface LabSql { query: (text: string, params?: unknown[]) => Promise<any[]> }
export interface Version { signalVersion: string; status: "active" | "killed"; killedAt: number | null; killReason: string | null; nClosed: number; pnlPaper: number; bhPnl: number | null }
export interface Snapshot { prices: Print[]; trades: PaperTrade[]; version: Version }
const stamp = (value: string | null) => value === null ? null : Date.parse(value);
export async function snapshot(sql: LabSql, decisionTs: number): Promise<Snapshot> {
  const rows = await sql.query(`select jsonb_build_object(
    'prices', (select coalesce(jsonb_agg(p order by p.ts), '[]') from
      (select ts, price from spot_prices_1m where ts + interval '1 minute' <= $1 order by ts desc limit 1000) p),
    'trades', (select coalesce(jsonb_agg(t order by t.id), '[]') from paper_spot_trades t where signal_version = $2),
    'version', (select to_jsonb(v) from spot_signal_versions v where signal_version = $2)
  ) as data`, [new Date(decisionTs).toISOString(), SIGNAL_VERSION]);
  const data = rows[0]?.data;
  if (!data?.version) throw new Error("paper research schema/version unavailable");
  const v = data.version;
  return {
    prices: data.prices.map((p: any) => ({ ts: Date.parse(p.ts), price: Number(p.price) })),
    trades: data.trades.map((t: any) => ({ id: String(t.id), signalVersion: t.signal_version, side: t.side, entryTs: Date.parse(t.entry_ts), entryPrice: Number(t.entry_price), exitTs: stamp(t.exit_ts), exitPrice: t.exit_price === null ? null : Number(t.exit_price), exitReason: t.exit_reason, gross: t.gross === null ? null : Number(t.gross), pnlPaper: t.pnl_paper === null ? null : Number(t.pnl_paper), status: t.status })),
    version: { signalVersion: v.signal_version, status: v.status, killedAt: stamp(v.killed_at), killReason: v.kill_reason, nClosed: Number(v.n_closed), pnlPaper: Number(v.pnl_paper), bhPnl: v.bh_pnl === null ? null : Number(v.bh_pnl) },
  };
}
export async function savePrint(sql: LabSql, price: number, printTs: number, observedTs: number): Promise<boolean> {
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(printTs) || !Number.isFinite(observedTs) || printTs > observedTs) return false;
  const ts = Math.floor(printTs / MINUTE) * MINUTE;
  const rows = await sql.query(`insert into spot_prices_1m(ts, price, source) values ($1, $2, 'coinbase-public-ticker')
    on conflict(ts) do update set price = excluded.price, source = excluded.source
    where spot_prices_1m.ts >= date_trunc('minute', $3::timestamptz) returning ts`, [new Date(ts).toISOString(), price, new Date(observedTs).toISOString()]);
  return rows.length > 0;
}
export async function applySignal(sql: LabSql, before: Snapshot, signal: SignalResult, decisionTs: number, tickTs: number): Promise<boolean> {
  const latest = before.trades.at(-1) ?? null;
  const after = before.trades.map(row => ({ ...row }));
  let returns: { gross: number; pnlPaper: number } | null = null;
  if (signal.action === "exit") {
    if (!latest || latest.status !== "open" || signal.price === null || !signal.exitReason) throw new Error("missing paper exit inputs");
    returns = paperReturn(latest.side, latest.entryPrice, signal.price);
    Object.assign(after[after.length - 1], { exitTs: decisionTs, exitPrice: signal.price, exitReason: signal.exitReason, ...returns, status: "closed" });
  }
  const closed = closedV1(after);
  const checkpoint = before.version.status === "active" && before.version.nClosed < 50 ? killCheckpoint(after) : null;
  const evaluate = checkpoint?.evaluated === true;
  const killed = evaluate && checkpoint!.killed;
  const sum = killed ? checkpoint!.pnlPaper : closed.reduce((total, row) => total + row.pnlPaper!, 0);
  const rows = await sql.query("select spot_apply_tick($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) as applied", [
    latest?.id ?? null, latest?.status ?? null, new Date(decisionTs).toISOString(), new Date(tickTs).toISOString(),
    signal.action, signal.side, signal.price, signal.exitReason, returns?.gross ?? null, returns?.pnlPaper ?? null,
    closed.length, sum, evaluate ? checkpoint!.bhPnl : before.version.bhPnl, killed, killed ? checkpoint!.reason : null,
  ]);
  return rows[0]?.applied === true;
}
