import type { AskLeadSnapshot } from "@/lib/desk/ask-lead.server";

function pct(v: number | null): string {
  return v == null ? "—" : `${(v * 100).toFixed(1)}%`;
}

function avg(v: number | null): string {
  return v == null ? "—" : v.toFixed(2);
}

function secs(v: number | null): string {
  if (v == null) return "—";
  const m = Math.floor(v / 60);
  const s = Math.round(v % 60);
  return `${m}m ${String(s).padStart(2, "0")}s left`;
}

export function AskLeadStudy({ data }: { data: AskLeadSnapshot | null }) {
  if (!data) {
    return (
      <section className="mt-6 rounded-md border border-border bg-canvas p-4">
        <div className="font-mono text-micro uppercase tracking-widest text-subtle">
          Higher-ask swaps
        </div>
        <p className="mt-2 font-mono text-micro leading-relaxed text-muted">
          The swap clock is temporarily unavailable. No live decision path depends on it.
        </p>
      </section>
    );
  }

  const observer = data.health.last_error
    ? "observer error"
    : data.health.started
      ? "collecting"
      : "not started";

  return (
    <section className="mt-6 rounded-md border border-border bg-surface p-4 sm:p-5" aria-labelledby="ask-lead-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-mono text-micro uppercase tracking-[0.18em] text-subtle">
            Measurement · no bot
          </div>
          <h2 id="ask-lead-title" className="mt-1 font-sans text-title font-medium text-fg">
            Higher-ask swaps
          </h2>
        </div>
        <span className="rounded-sm border border-border bg-canvas px-2 py-1 font-mono text-micro font-bold uppercase tracking-widest text-muted">
          {observer}
        </span>
      </div>

      <p className="mt-3 max-w-[90ch] font-sans text-ui leading-relaxed text-muted">
        How often the side with the higher Kalshi ask changes inside a 15-minute window,
        and when that happens. A swap is a confirmed YES↔NO lead change. Ties and one-tick
        flickers do not count. There is no 90¢ filter and no paper fill.
      </p>

      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <div>
          <dt className="font-mono text-micro uppercase tracking-widest text-subtle">Windows with a lead</dt>
          <dd className="mt-1 font-mono text-ui tabular text-fg">{data.with_lead} / {data.windows}</dd>
        </div>
        <div>
          <dt className="font-mono text-micro uppercase tracking-widest text-subtle">Avg swaps</dt>
          <dd className="mt-1 font-mono text-ui tabular text-fg">{avg(data.avg_swaps)}</dd>
        </div>
        <div>
          <dt className="font-mono text-micro uppercase tracking-widest text-subtle">0 / 1 / 2+</dt>
          <dd className="mt-1 font-mono text-ui tabular text-fg">
            {pct(data.share_0)} · {pct(data.share_1)} · {pct(data.share_2plus)}
          </dd>
        </div>
        <div>
          <dt className="font-mono text-micro uppercase tracking-widest text-subtle">Median last swap</dt>
          <dd className="mt-1 font-mono text-ui tabular text-fg">{secs(data.median_last_swap_secs)}</dd>
        </div>
        <div>
          <dt className="font-mono text-micro uppercase tracking-widest text-subtle">Last lead won settle</dt>
          <dd className="mt-1 font-mono text-ui tabular text-fg">
            {pct(data.last_lead_rate)} · n={data.last_lead_n}
          </dd>
        </div>
        <div>
          <dt className="font-mono text-micro uppercase tracking-widest text-subtle">Live lead</dt>
          <dd className="mt-1 font-mono text-ui tabular text-fg">
            {data.health.live_lead ?? "—"} · {data.health.live_swaps} swaps
          </dd>
        </div>
      </dl>

      <div className="mt-4 grid gap-2 border-t border-border pt-4 font-mono text-micro leading-relaxed text-subtle sm:grid-cols-2">
        <div>
          Clock of swaps: 15–10 {data.buckets["15_10"]} · 10–5 {data.buckets["10_5"]} · 5–2 {data.buckets["5_2"]} · last 2 {data.buckets.last_2}
        </div>
        <div>
          Weekend avg {avg(data.weekend.avg_swaps)} n={data.weekend.n}
          {" · "}
          Weekday avg {avg(data.weekday.avg_swaps)} n={data.weekday.n}
        </div>
      </div>
      <p className="mt-3 font-mono text-micro leading-relaxed text-subtle">
        Prospective from {new Date(data.since).toISOString().slice(0, 16)}Z. Median first swap{" "}
        {secs(data.median_first_swap_secs)}. A flat histogram and a last-lead rate near the
        priced favorite is a valid result. Authority: none.
      </p>
      {data.health.last_error ? (
        <p role="status" className="mt-3 font-mono text-micro text-wait">
          Observer: {data.health.last_error}
        </p>
      ) : null}
    </section>
  );
}
