import { useEffect, useState } from "react";
import { getAdminKey, subscribe } from "@/lib/desk/engine";
import type { ReadinessCheck } from "@/lib/desk/readiness";
import { Tip } from "./Tip";

/** The shape the /readiness endpoint returns (owner only). */
type Snap = {
  ready: boolean;
  met_count: number;
  total_count: number;
  frozen_at: string;
  checks: ReadinessCheck[];
  prompt: string;
  note: string;
  generated_at: number;
  info: {
    days_since_freeze: number;
    windows_all_time: number;
    chair_dir_since_freeze: number;
    taker_total: number;
    regimes: { regime: string; n: number }[];
    alerted: boolean;
  };
};

const nf = (n: number) => n.toLocaleString("en-US");

/**
 * SETTINGS → Evaluation readiness (owner only). A read-only gate that tells the
 * owner when enough out-of-sample data has accumulated since the TAKER v1 freeze
 * to run the first serious evaluation, and hands over the exact copy-paste
 * prompt to start it. Nothing here changes the chair, TAKER, or any seat. It is
 * gated on the admin key server-side (404 without it), so the public never sees
 * it; the panel simply hides until a key is present in this browser.
 */
export function ReadinessPanel() {
  const [key, setKey] = useState(getAdminKey);
  const [snap, setSnap] = useState<Snap | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  // Re-read the admin key whenever the desk emits, so the panel appears the
  // moment the key is entered in the Council panel above.
  useEffect(() => {
    const off = subscribe(() => setKey(getAdminKey()));
    return () => {
      off();
    };
  }, []);

  useEffect(() => {
    if (!key) {
      setSnap(null);
      setErr(null);
      return;
    }
    const ac = new AbortController();
    setLoading(true);
    setErr(null);
    fetch(`/readiness?key=${encodeURIComponent(key)}`, { signal: ac.signal, headers: { accept: "application/json" } })
      .then(async (r) => {
        if (r.status === 404) throw new Error("admin key not recognized");
        const j = (await r.json().catch(() => null)) as (Snap & { ok?: boolean; error?: string }) | null;
        if (!r.ok || !j || j.ok === false) throw new Error(j?.error || `readiness ${r.status}`);
        setSnap(j);
      })
      .catch((e) => {
        if (ac.signal.aborted) return;
        setErr(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, [key]);

  if (!key) return null; // owner only — hidden until the admin key is set

  const copy = async () => {
    if (!snap) return;
    try {
      await navigator.clipboard.writeText(snap.prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className="rounded-md border border-border bg-surface p-3 lg:col-span-2">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-mono text-micro uppercase tracking-widest text-subtle">
          <Tip k="settings.readiness">Evaluation readiness</Tip>
          <span className="ml-2 normal-case tracking-normal text-subtle">· owner only</span>
        </h3>
        {snap ? (
          <span
            className={`rounded-sm border px-2 py-0.5 font-mono text-micro ${
              snap.ready ? "border-up/50 bg-up/10 text-up" : "border-border text-muted"
            }`}
          >
            {snap.ready ? "READY" : `${snap.met_count}/${snap.total_count} · not yet`}
          </span>
        ) : null}
      </div>

      {loading && !snap ? <div className="font-mono text-micro text-subtle">checking…</div> : null}
      {err ? <div className="font-mono text-micro text-down">{err}</div> : null}

      {snap ? (
        <>
          <div className="mb-3 font-mono text-micro text-subtle">
            {nf(snap.info.windows_all_time)} graded windows on record · day {snap.info.days_since_freeze} since the{" "}
            {snap.frozen_at} freeze · TAKER {nf(snap.info.taker_total)} sampled · chair has booked{" "}
            {nf(snap.info.chair_dir_since_freeze)} call{snap.info.chair_dir_since_freeze === 1 ? "" : "s"} since
          </div>

          <ul className="mb-3 grid gap-1">
            {snap.checks.map((c) => (
              <li key={c.key} className="flex items-baseline justify-between gap-3 font-mono text-ui">
                <span className="flex items-baseline gap-2">
                  <span className={c.met ? "text-up" : "text-muted"}>{c.met ? "✓" : "○"}</span>
                  <span className={c.met ? "text-fg" : "text-muted"}>{c.label}</span>
                </span>
                <span className="shrink-0 text-right">
                  <span className={`tabular ${c.met ? "text-up" : "text-wait"}`}>
                    {nf(c.have)}
                    {c.key === "integrity" ? "" : ` / ${nf(c.need)}`}
                  </span>
                  {c.detail ? <span className="ml-2 text-subtle">{c.detail}</span> : null}
                </span>
              </li>
            ))}
          </ul>

          <div className="rounded-sm border border-border bg-bg p-2">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="font-mono text-micro uppercase tracking-widest text-subtle">
                {snap.ready ? "It's time — paste this to Claude" : "The prompt to run it (when ready)"}
              </span>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => void copy()}>
                {copied ? "copied" : "copy"}
              </button>
            </div>
            <textarea
              readOnly
              value={snap.prompt}
              onFocus={(e) => e.currentTarget.select()}
              rows={10}
              className="w-full resize-y rounded-sm border border-border bg-surface px-2 py-1.5 font-mono text-micro text-fg"
            />
          </div>

          <div className="mt-2 font-mono text-micro text-subtle">
            Read-only — this counts data and decides nothing. Turn on the Desk watchdog (Alerts) to also get a
            one-time push the moment the gate flips{snap.info.alerted ? " · already sent" : ""}.
          </div>
        </>
      ) : null}
    </section>
  );
}
