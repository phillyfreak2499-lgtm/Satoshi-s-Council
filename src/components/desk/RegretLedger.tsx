import { useEffect, useState } from "react";
type Band = {
  band: string;
  windows: number;
  settled: number;
  pending: number;
  missing_ask: number;
  booked_later: number;
  net_cents: number;
  never_booked_net_cents: number;
  floor_only_windows: number;
  floor_only_net_cents: number;
};
type Report = {
  definition: string;
  limits: string;
  start_at: string | null;
  bands: Band[];
  observation_bands: { band: string; observations: number; settled: number; net_cents: number }[];
  pending_journal: number;
  capture_failures_since_boot: number;
  last_capture_error: string | null;
};
export function RegretLedger() {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const pull = async () => {
      try {
        const r = await fetch("/api/regret", { signal: AbortSignal.timeout(10000) });
        if (!r.ok) throw Error("Regret ledger unavailable");
        const j = await r.json();
        if (alive) {
          setReport(j);
          setError(null);
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    };
    void pull();
    const timer = setInterval(() => void pull(), 60000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  return (
    <section
      className="my-6 rounded-md border border-border bg-surface p-4"
      aria-labelledby="regret-title"
    >
      <h2 id="regret-title" className="font-mono text-title">
        Unbooked directional reads · regret ledger
      </h2>
      <p className="my-2 text-ui text-muted">
        Prospective shadow entries at observed asks. Hypothetical one-contract results after the
        desk’s verified taker fee. No live orders. History before collection is incomplete.
      </p>
      {error ? (
        <p role="status">{error}</p>
      ) : report ? (
        <>
          <p className="text-ui text-muted">
            {report.definition} Collection first observed:{" "}
            {report.start_at ?? "no directional observations yet"}.
          </p>
          <div className="overflow-x-auto">
            <table className="my-3 w-full text-left font-mono text-micro">
              <thead>
                <tr>
                  {[
                    "Ask band",
                    "Windows",
                    "Settled",
                    "Pending / excluded",
                    "Missing ask",
                    "Booked later",
                    "Hypothetical net ¢",
                    "Never booked net ¢",
                    "Sole reported floor blocker",
                    "Sole floor blocker net ¢",
                  ].map((h) => (
                    <th key={h} className="p-2">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.bands.map((b) => (
                  <tr key={b.band}>
                    {[
                      b.band,
                      b.windows,
                      b.settled,
                      b.pending,
                      b.missing_ask,
                      b.booked_later,
                      b.net_cents.toFixed(1),
                      b.never_booked_net_cents.toFixed(1),
                      b.floor_only_windows,
                      b.floor_only_net_cents.toFixed(1),
                    ].map((v, i) => (
                      <td key={i} className="p-2">
                        {v}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <details className="my-3 text-ui">
            <summary>Every observed read by price band (repeated frames included)</summary>
            <p>These are observation totals, not independent trades or portfolio returns.</p>
            <table className="w-full text-left font-mono text-micro">
              <thead>
                <tr>
                  <th>Ask band</th>
                  <th>Reads</th>
                  <th>Settled</th>
                  <th>After-fee net ¢</th>
                </tr>
              </thead>
              <tbody>
                {report.observation_bands.map((b) => (
                  <tr key={b.band}>
                    <td>{b.band}</td>
                    <td>{b.observations}</td>
                    <td>{b.settled}</td>
                    <td>{b.net_cents.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
          <p className="text-ui text-muted">{report.limits}</p>
          <p role="status" className="text-ui text-muted">
            Pending durable receipts: {report.pending_journal}. Capture failures since server boot:{" "}
            {report.capture_failures_since_boot}. {report.last_capture_error}
          </p>
          <a className="text-ui underline" href="/api/regret">
            Read every observation and settlement receipt
          </a>
        </>
      ) : (
        <p role="status">Loading regret receipts…</p>
      )}
    </section>
  );
}
