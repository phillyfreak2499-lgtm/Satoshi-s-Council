import { useCallback, useEffect, useState } from "react";
import { getAdminKey } from "@/lib/desk/engine";

type Feature = {
  feature: string;
  model: string;
  calls: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  estimated_calls: number;
  price_missing_calls: number;
  usage_missing_calls: number;
  cost_usd_uncached_estimate: number;
  last_at: string | null;
};

type Snapshot = {
  generated_at: string;
  month_utc: string;
  scope: "month_to_date";
  accounting: {
    quality: "uncached_estimate";
    exact_billing: false;
    complete: boolean;
    note: string;
  };
  totals: {
    calls: number;
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    estimated_calls: number;
    price_missing_calls: number;
    usage_missing_calls: number;
    cost_usd_uncached_estimate: number;
  };
  by_feature: Feature[];
};

const money = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(n);

const count = (n: number) => n.toLocaleString("en-US");

const featureLabel = (feature: string) =>
  feature
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

/** SETTINGS owner panel: read-only AI spend observability. */
export function AiCostPanel() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    const key = getAdminKey();
    if (!key) return;
    setLoading(true);
    setErr(null);
    try {
      const response = await fetch("/owner/ai-cost", {
        headers: {
          accept: "application/json",
          "x-desk-admin": key,
        },
      });
      if (response.status === 404) throw new Error("owner key not recognized");
      const body = (await response.json().catch(() => null)) as
        | (Snapshot & { ok?: boolean; error?: string })
        | null;
      if (!response.ok || !body || body.ok === false) {
        throw new Error(body?.error || `AI cost ${response.status}`);
      }
      setSnap(body);
    } catch (error) {
      setErr(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="rounded-md border border-border bg-surface p-3 lg:col-span-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-mono text-micro uppercase tracking-widest text-subtle">
            AI cost · owner only
          </div>
          <h3 className="mt-1 font-sans text-title font-medium text-fg">
            {snap ? money(snap.totals.cost_usd_uncached_estimate) : "—"}
            <span className="ml-2 font-mono text-micro font-normal text-muted">
              {snap ? `${snap.month_utc} MTD uncached estimate` : "month to date"}
            </span>
          </h3>
        </div>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={loading}
          onClick={() => void load()}
        >
          {loading ? "refreshing…" : "refresh"}
        </button>
      </div>

      {err ? <p role="status" className="mt-3 font-mono text-micro text-down">{err}</p> : null}
      {loading && !snap ? (
        <p className="mt-3 font-mono text-micro text-subtle">reading the usage ledger…</p>
      ) : null}

      {snap ? (
        <>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <div className="rounded-sm border border-border bg-canvas p-2">
              <div className="font-mono text-micro uppercase tracking-widest text-subtle">Calls</div>
              <div className="mt-1 font-mono text-data tabular text-fg">{count(snap.totals.calls)}</div>
            </div>
            <div className="rounded-sm border border-border bg-canvas p-2">
              <div className="font-mono text-micro uppercase tracking-widest text-subtle">Tokens</div>
              <div className="mt-1 font-mono text-data tabular text-fg">{count(snap.totals.total_tokens)}</div>
            </div>
            <div className="rounded-sm border border-border bg-canvas p-2">
              <div className="font-mono text-micro uppercase tracking-widest text-subtle">Coverage</div>
              <div className="mt-1 font-mono text-data tabular text-fg">
                {snap.accounting.complete ? "complete" : "partial"}
              </div>
            </div>
          </div>

          <div className="mt-3 overflow-x-auto rounded-sm border border-border">
            <table className="w-full min-w-[44rem] text-left">
              <thead className="bg-canvas font-mono text-micro uppercase tracking-widest text-subtle">
                <tr>
                  <th className="px-2 py-2 font-medium">Feature</th>
                  <th className="px-2 py-2 font-medium">Model</th>
                  <th className="px-2 py-2 text-right font-medium">Calls</th>
                  <th className="px-2 py-2 text-right font-medium">Tokens</th>
                  <th className="px-2 py-2 text-right font-medium">Estimate</th>
                </tr>
              </thead>
              <tbody>
                {snap.by_feature.map((row) => (
                  <tr key={`${row.feature}:${row.model}`} className="border-t border-border font-mono text-micro">
                    <td className="px-2 py-2 text-fg">{featureLabel(row.feature)}</td>
                    <td className="px-2 py-2 text-muted">{row.model}</td>
                    <td className="px-2 py-2 text-right tabular text-muted">{count(row.calls)}</td>
                    <td className="px-2 py-2 text-right tabular text-muted">{count(row.total_tokens)}</td>
                    <td className="px-2 py-2 text-right tabular text-fg">{money(row.cost_usd_uncached_estimate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!snap.accounting.complete ? (
            <p role="status" className="mt-3 font-mono text-micro text-wait">
              Estimate coverage is incomplete: {snap.totals.price_missing_calls} call(s) lack a price and{" "}
              {snap.totals.usage_missing_calls} call(s) lack token usage. Missing cost is never treated as $0.
            </p>
          ) : null}

          <p className="mt-3 max-w-[90ch] font-mono text-micro leading-relaxed text-subtle">
            {snap.accounting.note} This is not the OpenAI invoice.
          </p>
        </>
      ) : null}
    </section>
  );
}
