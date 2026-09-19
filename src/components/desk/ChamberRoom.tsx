import { utcStamp } from "@/lib/desk/display-evidence";
import { RosterEvidence } from "./RosterEvidence";
import { PaperDisclaimer } from "./PaperDisclaimer";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Radar } from "lucide-react";
import { listChamberSpeech } from "@/lib/desk/chamber-speech";
import type { ChamberStatement } from "@/lib/desk/chamber-reactions";
import { SEAT_IDS } from "@/lib/desk/types";
import { GlobalHeader } from "./GlobalHeader";
import { Crest } from "./Crest";
import { CouncilVoiceButton } from "./CouncilVoiceButton";

const CAST = [
  ["SATOSHI", "Chair", "Speaks from finalized Chair milestones and recorded paper calls."],
  ["WARDEN", "Integrity", "Speaks on real Kalshi feed-health transitions."],
  ["ALCHEMIST", "Research", "Speaks from frozen, prospective Lab specimen milestones."],
  ["WRENCH", "Infrastructure", "Silent — no public infrastructure trigger yet."],
  ["SWEEP", "Conditions", "Speaks when the daily evidence sweep flags or clears a seat condition."],
  ["COACH", "Seat behavior", "Silent — no public team trigger yet."],
] as const;

const CAMERA_VIEWS = [
  ["overview", "Overview"],
  ["chair", "Chair"],
  ["lab", "Lab"],
  ["operations", "Operations"],
] as const;

// Presentation pause: keep the complete room implementation ready for the next visual pass.
const SHOW_CINEMATIC_ROOM = false;

type CameraView = (typeof CAMERA_VIEWS)[number][0];

type Exchange = {
  key: string;
  label: string;
  latest: string;
  statements: ChamberStatement[];
  repeats?: Exchange[];
};

function exchangeKey(s: ChamberStatement): string {
  const e = s.evidence;
  if (e.ticker && e.close_time) return `window:${e.ticker}:${e.close_time}`;
  if (e.candidate_id) return `experiment:${e.candidate_id}`;
  return `event:${s.event_key}`;
}

function exchangeLabel(row: ChamberStatement): string {
  const e = row.evidence;
  return e.ticker || e.candidate_label || e.candidate_id || e.seat || "desk event";
}

function utcDate(value: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(value));
  } catch {
    return value.slice(0, 10);
  }
}

function groupExchanges(rows: ChamberStatement[]): Exchange[] {
  const map = new Map<string, Exchange>();
  for (const row of rows) {
    const key = exchangeKey(row);
    const existing = map.get(key);
    if (existing) {
      existing.statements.unshift(row);
      continue;
    }
    map.set(key, {
      key,
      label: exchangeLabel(row),
      latest: row.occurred_at,
      statements: [row],
    });
  }
  return [...map.values()];
}

function waitFingerprint(exchange: Exchange): string | null {
  if (exchange.statements.length !== 1) return null;
  const statement = exchange.statements[0];
  if (statement.speaker !== "SATOSHI" || statement.evidence.kind !== "chair-wait") return null;
  return (statement.evidence.wait_reason || statement.text).trim().toLowerCase();
}

function compactRepeatedWaits(exchanges: Exchange[]): Exchange[] {
  const compact: Exchange[] = [];
  for (const exchange of exchanges) {
    const fingerprint = waitFingerprint(exchange);
    const previous = compact[compact.length - 1];
    if (fingerprint && previous && waitFingerprint(previous) === fingerprint) {
      previous.repeats = [...(previous.repeats ?? []), exchange];
    } else {
      compact.push({ ...exchange });
    }
  }
  return compact;
}

function SpeakerMark({ speaker }: { speaker: ChamberStatement["speaker"] }) {
  const hasPortrait = speaker !== "SWEEP";

  return (
    <span className="chamber-speaker-mark" data-speaker={speaker} aria-hidden="true">
      {hasPortrait ? (
        <span className="chamber-speaker-portrait" />
      ) : (
        <Radar className="chamber-speaker-glyph" strokeWidth={1.6} />
      )}
    </span>
  );
}

function Evidence({ statement }: { statement: ChamberStatement }) {
  const [open, setOpen] = useState(false);
  const e = statement.evidence;
  return (
    <div className="mt-2">
      <button
        type="button"
        className="min-h-11 font-mono text-micro uppercase tracking-widest text-muted hover:text-fg sm:min-h-0"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "Hide evidence" : "Show evidence"}
      </button>
      {open ? (
        <dl className="mt-2 grid gap-x-4 gap-y-1 border-l border-border pl-3 font-mono text-micro text-subtle sm:grid-cols-2">
          {e.kind === "chair-wait" ? (
            <div><dt className="inline text-muted">reason </dt><dd className="inline">{e.wait_reason || "—"}</dd></div>
          ) : e.kind === "chair-directional" ? (
            <>
              <div><dt className="inline text-muted">side </dt><dd className="inline">{e.lean || "—"}</dd></div>
              <div><dt className="inline text-muted">paper entry </dt><dd className="inline tabular">{e.entry_cents != null ? `${e.entry_cents}¢` : "—"}</dd></div>
            </>
          ) : e.kind === "experiment" ? (
            <>
              <div><dt className="inline text-muted">specimen </dt><dd className="inline">{e.candidate_label || e.candidate_id || "—"}</dd></div>
              <div><dt className="inline text-muted">countable sample </dt><dd className="inline tabular">{e.sample_n ?? "—"}</dd></div>
              {e.milestone != null ? <div><dt className="inline text-muted">milestone </dt><dd className="inline tabular">{e.milestone}</dd></div> : null}
              <div><dt className="inline text-muted">paired vs {e.control_id || "control"} </dt><dd className="inline tabular">{e.paired_n != null ? `${e.paired_n} windows` : "—"}{e.paired_delta != null ? ` · ${e.paired_delta >= 0 ? "+" : ""}${e.paired_delta}¢ avg` : ""}</dd></div>
              {e.frozen_at ? <div><dt className="inline text-muted">frozen </dt><dd className="inline tabular">{new Date(e.frozen_at).toISOString()}</dd></div> : null}
              <div><dt className="inline text-muted">authority </dt><dd className="inline">{e.paper_only ? "paper-only" : "—"} · {e.authority || "none"}</dd></div>
            </>
          ) : e.kind === "seat-audit" ? (
            <>
              <div><dt className="inline text-muted">seat </dt><dd className="inline">{e.seat || "—"}</dd></div>
              <div><dt className="inline text-muted">transition </dt><dd className="inline">{e.action || "—"}</dd></div>
              <div><dt className="inline text-muted">raw reads </dt><dd className="inline tabular">{e.reads ?? "—"}</dd></div>
              <div><dt className="inline text-muted">heard reads </dt><dd className="inline tabular">{e.spoke ?? "—"}{e.gagged != null ? ` · ${e.gagged} held back` : ""}</dd></div>
              <div><dt className="inline text-muted">mid-window sample </dt><dd className="inline tabular">{e.mid_n ?? "—"}{e.mid_hit_pct != null ? ` · ${e.mid_hit_pct}% right` : ""}</dd></div>
              <div><dt className="inline text-muted">ask economics </dt><dd className="inline tabular">{e.mid_cents != null ? `${e.mid_cents >= 0 ? "+" : ""}${e.mid_cents}¢ avg` : "—"}</dd></div>
              <div><dt className="inline text-muted">graded </dt><dd className="inline tabular">{e.grade_n ?? "—"}</dd></div>
              <div><dt className="inline text-muted">authority </dt><dd className="inline">none · observation only</dd></div>
            </>
          ) : (
            <>
              <div><dt className="inline text-muted">feed </dt><dd className="inline">{e.feed || "—"}</dd></div>
              <div><dt className="inline text-muted">continuity </dt><dd className="inline">{e.gap || "—"}</dd></div>
              {e.receipt_age_s != null ? <div><dt className="inline text-muted">receipt age </dt><dd className="inline tabular">{e.receipt_age_s}s</dd></div> : null}
              {e.last_change_age_s != null ? <div><dt className="inline text-muted">last change </dt><dd className="inline tabular">{e.last_change_age_s}s</dd></div> : null}
            </>
          )}
          {e.ticker ? <div className="min-w-0"><dt className="inline text-muted">window </dt><dd className="inline break-all">{e.ticker}</dd></div> : null}
          {e.close_time ? <div><dt className="inline text-muted">close </dt><dd className="inline tabular">{new Date(e.close_time).toISOString()}</dd></div> : null}
          {e.failed_hard.length ? <div><dt className="inline text-muted">gates </dt><dd className="inline">{e.failed_hard.join(" · ")}</dd></div> : null}
          {e.quorum ? <div><dt className="inline text-muted">quorum at dispatch </dt><dd className="inline">{e.quorum.up} up · {e.quorum.down} down · {e.quorum.wait} wait</dd></div> : null}
          <RosterEvidence statement={statement} />
          {e.score != null && e.bar != null ? <div><dt className="inline text-muted">score / bar </dt><dd className="inline tabular">{e.score} / {e.bar}</dd></div> : null}
        </dl>
      ) : null}
    </div>
  );
}

function Statement({ statement }: { statement: ChamberStatement }) {
  return (
    <article className="relative border-l border-border pl-4 sm:pl-5">
      <span className="absolute -left-[3px] top-3 size-[5px] rounded-full bg-subtle" aria-hidden="true" />
      <div className="flex items-start gap-3">
        <SpeakerMark speaker={statement.speaker} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="font-mono text-micro font-bold uppercase tracking-[0.16em] text-fg">{statement.speaker}</span>
            <time className="font-mono text-micro tabular text-subtle" dateTime={statement.occurred_at}>
              {utcStamp(statement.occurred_at)}
            </time>
          </div>
          <p className="mt-1 max-w-[72ch] font-sans text-body leading-relaxed text-fg">{statement.text}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <CouncilVoiceButton
              source="chamber"
              speaker={statement.speaker}
              eventKey={statement.event_key}
              label="Hear"
            />
            <span className="font-mono text-micro text-subtle">AI-generated character voice</span>
          </div>
          <Evidence statement={statement} />
        </div>
      </div>
    </article>
  );
}


function RoomStage({ latest, loaded }: { latest: ChamberStatement | null; loaded: boolean }) {
  const [view, setView] = useState<CameraView>("overview");
  const speaker = latest?.speaker ?? null;
  const roomState = !loaded ? "LISTENING" : speaker ? "EVENT RECEIVED" : "QUIET";
  const status = latest ? `${latest.speaker} · ${latest.evidence.kind.replaceAll("-", " ")}` : "No evidence-backed dispatch";
  const activeSeat = latest?.evidence.seat?.toUpperCase() ?? null;

  return (
    <section className="chamber-stage" aria-labelledby="room-stage-heading" data-speaker={speaker ?? "QUIET"} data-view={view}>
      <div className="chamber-stage-scan" aria-hidden="true" />
      <div className="chamber-stage-head">
        <div>
          <div className="chamber-stage-kicker">Institution view · observational</div>
          <h2 id="room-stage-heading" className="chamber-stage-title">Council room</h2>
        </div>
        <div className="chamber-stage-state">
          <span className="chamber-stage-state-dot" aria-hidden="true" />
          {roomState}
        </div>
      </div>

      <div className="chamber-camera" role="group" aria-label="Council room camera">
        <span className="chamber-camera-label">Camera</span>
        {CAMERA_VIEWS.map(([id, label]) => (
          <button
            className="chamber-camera-button"
            type="button"
            aria-pressed={view === id}
            onClick={() => setView(id)}
            key={id}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="chamber-world">
        <div className="chamber-scene">
          <div className="chamber-vault" aria-hidden="true" />
          <div className="chamber-aisle" aria-hidden="true" />
          <div className="chamber-throne-platform" aria-hidden="true" />

          <div className="chamber-institution-mark" aria-hidden="true">
            <Crest size={82} figure title="Satoshi's Council" />
          </div>

          <div className="chamber-motto chamber-motto-left" aria-hidden="true">
            <span>CURIOSITY</span>
            <span>DISCIPLINE</span>
            <span>PATIENCE</span>
            <span>PROGRESS</span>
          </div>
          <div className="chamber-motto chamber-motto-right" aria-hidden="true">
            <span>SAME QUESTIONS</span>
            <span>BRIGHTER TOMORROW</span>
          </div>

          <div className="chamber-bay chamber-bay-lab" aria-hidden="true">
            <span /><span /><span /><span /><span /><span />
          </div>
          <div className="chamber-bay chamber-bay-ops" aria-hidden="true">
            <span /><span /><span /><span /><span /><span />
          </div>
          <div className="chamber-figure chamber-figure-alchemist" aria-hidden="true" />
          <div className="chamber-figure chamber-figure-satoshi" aria-hidden="true" />
          <div className="chamber-figure chamber-figure-warden" aria-hidden="true" />

          <div className="chamber-wing chamber-wing-lab">
          <span>THE LAB</span>
          <small>RESEARCH</small>
        </div>
        <div className="chamber-wing chamber-wing-ops">
          <span>OPERATIONS</span>
          <small>INTEGRITY</small>
        </div>

        <div className="chamber-dais">
          <div className="chamber-dais-mark"><Crest size={38} figure title="SATOSHI" /></div>
          <div className="chamber-dais-name">SATOSHI</div>
          <div className="chamber-dais-role">CHAIR</div>
        </div>

        <div className="chamber-seat-ring" role="list" aria-label="The 21 Council seats">
          {SEAT_IDS.map((seat, index) => {
            const angle = (15 + (150 * index) / Math.max(1, SEAT_IDS.length - 1)) * (Math.PI / 180);
            const arcDepth = Math.sin(angle);
            const centerIndex = (SEAT_IDS.length - 1) / 2;
            const seatNumber = String(index + 1).padStart(2, "0");
            const style = {
              "--seat-left": `${50 + 43 * Math.cos(angle)}%`,
              "--seat-top": `${23 + 54 * arcDepth}%`,
              "--seat-delay": `${index * 8}ms`,
              "--seat-scale": (0.74 + 0.26 * arcDepth).toFixed(3),
              "--seat-turn": `${((index - centerIndex) * 1.8).toFixed(1)}deg`,
              "--seat-z": String(Math.round(40 + 60 * arcDepth)),
            } as CSSProperties;
            return (
              <div
                className="chamber-seat"
                style={style}
                role="listitem"
                aria-label={`${seat}, Council seat ${seatNumber}`}
                data-active={activeSeat === String(seat).toUpperCase() ? "true" : undefined}
                key={seat}
                title={`${seatNumber} · ${seat}`}
              >
                <span className="chamber-seat-screen" aria-hidden="true">
                  <span className="chamber-seat-lamp" />
                </span>
                <span className="chamber-seat-label">
                  <span className="chamber-seat-id" aria-hidden="true">{seatNumber}</span>
                  <span className="chamber-seat-name">{seat}</span>
                </span>
              </div>
            );
          })}
        </div>

        <div className="chamber-floor-seal" aria-hidden="true">₿</div>

        </div>

        <div className="chamber-dispatch" aria-live="polite">
          <div className="chamber-dispatch-meta">{status}</div>
          <p>{latest?.text ?? (loaded ? "The room is quiet." : "Listening for structured events…")}</p>
        </div>
      </div>

      <div className="chamber-stage-foot">
        <span>21 COUNCIL SEATS</span>
        <span>LAB · LEFT WING</span>
        <span>OPERATIONS · RIGHT WING</span>
        <span>READ ONLY</span>
      </div>
    </section>
  );
}

export function ChamberRoom({ initial = [] }: { initial?: ChamberStatement[] }) {
  const [rows, setRows] = useState<ChamberStatement[]>(initial);
  const [loaded, setLoaded] = useState(true);

  useEffect(() => {
    let mounted = true;
    const pull = async () => {
      try {
        const next = await listChamberSpeech();
        if (mounted) setRows(next);
      } finally {
        if (mounted) setLoaded(true);
      }
    };
    void pull();
    const timer = window.setInterval(() => void pull(), 12_000);
    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, []);

  const exchanges = useMemo(() => compactRepeatedWaits(groupExchanges(rows)), [rows]);

  return (
    <div className="min-h-dvh bg-bg text-fg">
      <a href="#chamber-main" className="skip-link">Skip to content</a>
      <GlobalHeader />

      <main id="chamber-main" className="council-reading-page council-page-wide gutter mx-auto w-full py-6 sm:py-8">
        <section className="chamber-intro border-b border-border pb-6">
          <div className="font-mono text-micro uppercase tracking-[0.2em] text-subtle">The Chamber · Read only · Council commentary</div>
          <h1 className="council-page-title mt-2 font-sans text-display font-medium tracking-tight">Inside the Council.</h1>
          <p className="mt-2 max-w-[70ch] font-sans text-body leading-relaxed text-muted">
            Follow the Council’s response to what the desk observes. Each exchange is tied to a recorded event, with its supporting evidence available to read.
          </p>
          <p className="mt-3 max-w-[78ch] font-mono text-micro leading-relaxed text-subtle">
            Chamber speech is downstream only. It cannot change the Chair, the learner, a seat, the Lab, or the paper book. When no evidence-backed event earns a voice, the room stays quiet.
          </p>
          <p className="mt-2 max-w-[78ch] font-mono text-micro leading-relaxed text-subtle">
            Optional playback uses AI-generated fictional character voices. The recorded text and evidence remain the canonical record.
          </p>
          <a href="/training/wick" className="btn btn-secondary mt-4">Train with WICK ↗</a>
        </section>

        {SHOW_CINEMATIC_ROOM ? <RoomStage latest={rows[0] ?? null} loaded={loaded} /> : null}

        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
          <section aria-labelledby="exchange-heading">
            <div className="mb-3 flex items-end justify-between gap-3">
              <div>
                <div className="font-mono text-micro uppercase tracking-widest text-subtle">Observed conversation</div>
                <h2 id="exchange-heading" className="mt-1 font-sans text-title font-medium">Live exchanges</h2>
              </div>
              <div className="font-mono text-micro text-subtle">refreshes every 12s</div>
            </div>

            {!loaded ? (
              <div className="rounded-md border border-border bg-surface p-5 font-mono text-ui text-muted">Listening for structured events…</div>
            ) : exchanges.length === 0 ? (
              <div className="rounded-md border border-border bg-surface p-5">
                <div className="font-mono text-ui text-fg">The room is quiet.</div>
                <p className="mt-1 font-sans text-ui text-muted">No evidence-backed event has earned a voice.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {exchanges.map((exchange) => (
                  <section key={exchange.key} className="rounded-md border border-border bg-surface p-4 sm:p-5">
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
                      <div className="min-w-0 font-mono text-micro uppercase tracking-widest text-subtle">
                        {exchange.statements.length > 1 ? "Exchange" : "Dispatch"} · <span className="break-all text-muted">{exchange.label}</span>
                      </div>
                      <time className="font-mono text-micro tabular text-subtle" dateTime={exchange.latest}>
                        {utcDate(exchange.latest)}
                      </time>
                    </div>
                    <div className="space-y-5">
                      {exchange.statements.map((statement) => <Statement key={statement.event_key} statement={statement} />)}
                    </div>
                    {exchange.repeats?.length ? (
                      <details className="mt-4 border-t border-border pt-3">
                        <summary className="min-h-11 cursor-pointer list-none py-2 font-mono text-micro uppercase tracking-widest text-muted marker:content-none sm:min-h-0">
                          {exchange.repeats.length} earlier identical WAIT {exchange.repeats.length === 1 ? "dispatch" : "dispatches"} · full evidence
                        </summary>
                        <div className="mt-3 space-y-5">
                          {exchange.repeats.flatMap((repeated) =>
                            repeated.statements.map((statement) => (
                              <Statement key={statement.event_key} statement={statement} />
                            )),
                          )}
                        </div>
                      </details>
                    ) : null}
                  </section>
                ))}
              </div>
            )}
          </section>

          <aside className="space-y-3" aria-labelledby="cast-heading">
            <div>
              <div className="font-mono text-micro uppercase tracking-widest text-subtle">Organization</div>
              <h2 id="cast-heading" className="mt-1 font-sans text-title font-medium">Who can speak</h2>
            </div>
            <div className="overflow-hidden rounded-md border border-border bg-surface">
              {CAST.map(([name, role, status], i) => (
                <div key={name} className={i ? "border-t border-border p-3" : "p-3"}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-mono text-micro font-bold tracking-widest text-fg">{name}</span>
                    <span className="font-mono text-micro text-subtle">{role}</span>
                  </div>
                  <p className="mt-1 font-sans text-ui leading-snug text-muted">{status}</p>
                </div>
              ))}
            </div>
            <div className="rounded-md border border-border bg-canvas p-3 font-mono text-micro leading-relaxed text-subtle">
              No character can talk another character into a production decision. Evidence first; presentation second.
            </div>
          </aside>
        </div>
      </main>
      <PaperDisclaimer />
    </div>
  );
}
