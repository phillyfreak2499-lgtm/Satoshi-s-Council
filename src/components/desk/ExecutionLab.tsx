import type { PublicLabSnapshot } from "@/lib/desk/lab-public";
export function ExecutionLab({ data }: { data: PublicLabSnapshot["execution_lab"] }) {
  if (!data) return <section className="mt-6 rounded-md border border-border p-4">Execution tests: research report unavailable.</section>;
  const fmt = (v: number | null) => v == null ? "—" : `${Number(v).toFixed(1)}¢`;
  return <section className="mt-6 rounded-md border border-border p-4" aria-label="Seven execution tests">
    <h2 className="font-sans text-title font-medium">Seven execution tests</h2>
    <p className="mt-2 text-ui text-muted">Paper research · no production authority · {data.enabled ? "enabled" : "not collecting"}.</p>
    <p className="mt-2 text-ui text-muted">Same actual entries for exit tests. Late-only watches for a fresh entry in the last two minutes. Exit prices are observed bids, with both fees. The 50¢ trigger uses the book midpoint, not a calibrated probability.</p>
    {data.start && <p className="mt-2 text-ui">Frozen run: {new Date(data.start).toISOString()} to {new Date(data.end!).toISOString()}. Captured {data.captured} windows; {data.pending} pending grades.</p>}
    <p className="mt-2 text-ui text-muted">Last capture: {data.health.last_capture ? new Date(data.health.last_capture).toISOString() : "none"}. Observation skips: {data.health.skips}.</p>
    {data.health.error && <p className="mt-2 text-ui">Collector issue: {data.health.error}</p>}
    <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-ui">
      <thead><tr><th>Test</th><th>Graded positions</th><th>Net</th><th>Primary HOLD control</th><th>Difference</th><th>Invalid</th><th>No entry</th></tr></thead>
      <tbody>{data.rows.map(r=><tr key={r.id} className="border-t border-border"><td className="py-2">{r.label}</td><td>{r.n}</td><td>{fmt(r.net)}</td><td>{fmt(r.hold)}</td><td>{fmt(r.delta)}</td><td>{r.invalid}</td><td>{r.no_entry}</td></tr>)}</tbody>
    </table></div>
    <p className="mt-2 text-ui text-muted">Late-only compares all complete windows with primary HOLD, including observed no-entry windows. Exit tests compare identical primary positions.</p>
    <p className="mt-3 text-ui text-muted">Missing data is excluded and listed. Results cannot change floors, thresholds or booking rules. Any change requires the owner's explicit decision.</p>
  </section>;
}
