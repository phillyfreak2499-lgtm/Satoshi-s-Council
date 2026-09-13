import { useEffect, useState } from "react";
import { listChamberSpeech } from "@/lib/desk/chamber-wait.server";
import type { ChamberStatement } from "@/lib/desk/chamber-reactions";
import { Crest } from "./Crest";

/**
 * Chamber PR 1 — one SATOSHI sentence above the seat grid.
 * Read-only. No composer, no POST, no write createServerFn.
 */
export function ChamberSpeech() {
  const [speech, setSpeech] = useState<ChamberStatement | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let live = true;
    const pull = async () => {
      try {
        const rows = await listChamberSpeech();
        if (live) setSpeech(rows[0] ?? null);
      } catch {
        if (live) setSpeech(null);
      }
    };
    void pull();
    const t = window.setInterval(() => void pull(), 12_000);
    return () => {
      live = false;
      window.clearInterval(t);
    };
  }, []);

  if (!speech) return null;

  const q = speech.evidence.quorum;
  const close = speech.evidence.close_time;
  const score = speech.evidence.score;
  const bar = speech.evidence.bar;

  return (
    <aside className="mb-3 rounded-md border border-border bg-surface px-3 py-2" aria-label="Satoshi chamber moment">
      <div className="flex items-start gap-2">
        <Crest size={20} figure className="mt-0.5 shrink-0" title="SATOSHI" />
        <div className="min-w-0 flex-1">
          <div className="font-mono text-micro uppercase tracking-widest text-subtle">SATOSHI</div>
          <p className="mt-0.5 font-sans text-ui text-fg">{speech.text}</p>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="mt-1 min-h-11 font-mono text-micro uppercase tracking-widest text-muted hover:text-fg sm:min-h-0"
            aria-expanded={open}
          >
            Why?
          </button>
          {open ? (
            <dl className="mt-1 space-y-0.5 font-mono text-micro text-subtle">
              <div>
                <dt className="inline text-muted">reason </dt>
                <dd className="inline">{speech.evidence.wait_reason || "—"}</dd>
              </div>
              {speech.evidence.ticker ? (
                <div>
                  <dt className="inline text-muted">window </dt>
                  <dd className="inline truncate">{speech.evidence.ticker}</dd>
                </div>
              ) : null}
              {close ? (
                <div>
                  <dt className="inline text-muted">close </dt>
                  <dd className="inline tabular">{new Date(close).toISOString()}</dd>
                </div>
              ) : null}
              {speech.evidence.failed_hard.length ? (
                <div>
                  <dt className="inline text-muted">gates </dt>
                  <dd className="inline">{speech.evidence.failed_hard.join(" · ")}</dd>
                </div>
              ) : null}
              {q ? (
                <div>
                  <dt className="inline text-muted">quorum </dt>
                  <dd className="inline">
                    {q.up} up · {q.down} down · {q.wait} wait
                  </dd>
                </div>
              ) : null}
              {score != null && bar != null ? (
                <div>
                  <dt className="inline text-muted">score </dt>
                  <dd className="inline tabular">
                    {score} / {bar}
                  </dd>
                </div>
              ) : null}
            </dl>
          ) : null}
        </div>
      </div>
    </aside>
  );
}
