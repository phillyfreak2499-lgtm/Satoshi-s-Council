import { useEffect, useState } from "react";
import { listChamberSpeech } from "@/lib/desk/chamber-speech";
import type { ChamberStatement } from "@/lib/desk/chamber-reactions";
import { Crest } from "./Crest";

function SpeakerMark({ speaker }: { speaker: ChamberStatement["speaker"] }) {
  if (speaker === "SATOSHI") {
    return <Crest size={20} figure className="mt-0.5 shrink-0" title="SATOSHI" />;
  }
  return (
    <span
      className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-sm border border-border bg-canvas font-mono text-[9px] font-bold text-subtle"
      aria-hidden="true"
    >
      W
    </span>
  );
}

/** Read-only live Chamber moment. No composer, no POST, no write createServerFn. */
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

  const e = speech.evidence;
  const q = e.quorum;
  const close = e.close_time;
  const score = e.score;
  const bar = e.bar;

  return (
    <aside className="mb-3 rounded-md border border-border bg-surface px-3 py-2" aria-label="Live Chamber moment">
      <div className="flex items-start gap-2">
        <SpeakerMark speaker={speech.speaker} />
        <div className="min-w-0 flex-1">
          <div className="font-mono text-micro uppercase tracking-widest text-subtle">{speech.speaker}</div>
          <p className="mt-0.5 font-sans text-ui text-fg">{speech.text}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="min-h-11 font-mono text-micro uppercase tracking-widest text-muted hover:text-fg sm:min-h-0"
              aria-expanded={open}
            >
              Evidence
            </button>
            <a href="/chamber" className="min-h-11 font-mono text-micro uppercase tracking-widest text-muted hover:text-fg sm:min-h-0 sm:leading-none">
              Enter the Chamber →
            </a>
          </div>
          {open ? (
            <dl className="mt-1 space-y-0.5 font-mono text-micro text-subtle">
              {e.kind === "chair-wait" ? (
                <div>
                  <dt className="inline text-muted">reason </dt>
                  <dd className="inline">{e.wait_reason || "—"}</dd>
                </div>
              ) : (
                <>
                  <div>
                    <dt className="inline text-muted">feed </dt>
                    <dd className="inline">{e.feed || "—"}</dd>
                  </div>
                  {e.receipt_age_s != null ? (
                    <div>
                      <dt className="inline text-muted">receipt age </dt>
                      <dd className="inline tabular">{e.receipt_age_s}s</dd>
                    </div>
                  ) : null}
                  {e.last_change_age_s != null ? (
                    <div>
                      <dt className="inline text-muted">last change </dt>
                      <dd className="inline tabular">{e.last_change_age_s}s</dd>
                    </div>
                  ) : null}
                  {e.gap ? (
                    <div>
                      <dt className="inline text-muted">continuity </dt>
                      <dd className="inline">{e.gap}</dd>
                    </div>
                  ) : null}
                </>
              )}
              {e.ticker ? (
                <div>
                  <dt className="inline text-muted">window </dt>
                  <dd className="inline truncate">{e.ticker}</dd>
                </div>
              ) : null}
              {close ? (
                <div>
                  <dt className="inline text-muted">close </dt>
                  <dd className="inline tabular">{new Date(close).toISOString()}</dd>
                </div>
              ) : null}
              {e.failed_hard.length ? (
                <div>
                  <dt className="inline text-muted">gates </dt>
                  <dd className="inline">{e.failed_hard.join(" · ")}</dd>
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
