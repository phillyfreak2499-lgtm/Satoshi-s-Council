import { createServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import type { spotReport } from "@/lib/spot-lab/spot-lab.server";

type Report = Awaited<ReturnType<typeof spotReport>>;
export const readSpotLab = createServerFn({ method: "GET" }).handler(async (): Promise<Report> => {
  const { spotReport } = await import("@/lib/spot-lab/spot-lab.server");
  return spotReport();
});
const pct = (value: number | null) => value === null ? "—" : `${(value * 100).toFixed(4)}%`;
const price = (value: number | null) => value === null ? "—" : value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const time = (value: number | null) => value === null ? "—" : new Date(value).toISOString();
export function SpotLabPage({ initial }: { initial: Report }) {
  const [report, setReport] = useState(initial);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    let disposed = false;
    let pending = false;
    const refresh = async () => {
      if (pending) return;
      pending = true;
      try {
        const next = await readSpotLab();
        if (!disposed) { setReport(next); setUnavailable(false); }
      } catch { if (!disposed) setUnavailable(true); }
      finally { pending = false; }
    };
    const timer = setInterval(() => void refresh(), 15000);
    return () => { disposed = true; clearInterval(timer); };
  }, []);
  const state = report.ok && !unavailable ? report.state : null;
  const open = state?.trades.find(trade => trade.status === "open");
  const closed = state?.trades.filter(trade => trade.status === "closed") ?? [];
  const gate = report.ok && !unavailable ? report.gate : null;
  return <main className="mx-auto min-h-dvh max-w-5xl px-4 py-6 text-fg sm:px-8">
    <p className="rounded-md border border-border bg-surface p-4 text-body font-medium">Paper research — not financial advice. Signals only.</p>
    <h1 className="mt-8 text-title font-medium">Bitcoin spot-signal lab</h1>
    <p className="mt-2 font-mono text-micro text-muted">{report.signalVersion} · authority: {report.authority} · collector {report.pollerEnabled ? "enabled" : "off"}</p>
    <p className="mt-2 text-body text-muted">Simulated long/short returns. Gross of market fees; net of a declared 10 bps round-trip haircut (5 bps per side), not a measured Coinbase fee. Last stored print is a paper mark.</p>
    {unavailable || !report.ok ? <p role="alert" className="mt-6 rounded-md border border-border p-4 text-body">Storage unavailable. No confirmed book or position can be shown.</p> : null}
    {state && gate ? <>
      <section className="mt-8 rounded-md border border-border p-4" aria-labelledby="spot-gates">
        <h2 id="spot-gates" className="text-body font-medium">Live gate state</h2>
        <p className="mt-2 text-body">Version: {state.version.status}{state.version.killReason ? ` · ${state.version.killReason}` : ""}</p>
        <p className="mt-2 text-body">{gate.warmup < 60 ? `Warming up: ${gate.warmup}/60 contiguous closed minutes.` : "60 contiguous closed minutes available."} {gate.price === null ? "No closed observations yet." : `Last closed print: ${price(gate.price)} · age ${gate.ageSeconds?.toFixed(0)}s · ${gate.fresh ? "fresh" : "stale for entry"}.`}</p>
        <p className="mt-2 font-mono text-micro">SMA 20 {price(gate.smaFast)} · SMA 60 {price(gate.smaSlow)} · ROC 15 {pct(gate.roc15)}</p>
        <p className="mt-2 text-body">Raw long gate: {gate.longGate ? "true" : "false"} · raw short gate: {gate.shortGate ? "true" : "false"} · current eligible action: {gate.action}{gate.exitReason ? ` (${gate.exitReason})` : ""}</p>
        <p className="mt-2 text-body text-muted">Last successful collector tick: {time(report.lastTick)}{report.lastError ? ` · ${report.lastError}` : ""}</p>
      </section>
      <section className="mt-6 rounded-md border border-border p-4" aria-labelledby="spot-position">
        <h2 id="spot-position" className="text-body font-medium">Open paper position</h2>
        <p className="mt-2 text-body">{open ? `${open.side} · ${price(open.entryPrice)} · ${time(open.entryTs)}` : "none"}</p>
        {state.version.status === "killed" && open ? <p className="mt-2 text-body">Killed flatten pending the next enabled tick with a valid stored closed print.</p> : null}
        <p className="mt-2 text-body text-muted">Version receipt: {state.version.nClosed} closed · summed paper return {pct(state.version.pnlPaper)} · fixed buy-and-hold baseline {pct(state.version.bhPnl)}</p>
        {state.version.killedAt !== null ? <p className="mt-2 text-body text-muted">Killed at {time(state.version.killedAt)}. Checkpoint receipt is frozen; trade history remains below.</p> : null}
      </section>
      <section className="mt-8" aria-labelledby="spot-history">
        <h2 id="spot-history" className="text-title font-medium">Every closed paper trade ({closed.length})</h2>
        {!closed.length ? <p className="mt-3 text-body text-muted">No closed paper trades recorded.</p> : null}
        <ul className="mt-4 list-none space-y-3 p-0">{closed.map(trade => <li key={trade.id} className="rounded-md border border-border p-4">
          <p className="text-body font-medium">#{trade.id} · {trade.side} · {trade.exitReason} · {trade.pnlPaper! > 0 ? "gain" : trade.pnlPaper! < 0 ? "loss" : "flat"}</p>
          <p className="mt-2 break-words font-mono text-micro text-muted">Entry {time(trade.entryTs)} at {price(trade.entryPrice)}<br />Exit {time(trade.exitTs)} at {price(trade.exitPrice)}</p>
          <p className="mt-2 text-body">Gross {pct(trade.gross)} · paper net {pct(trade.pnlPaper)}</p>
        </li>)}</ul>
      </section>
    </> : null}
  </main>;
}
