/**
 * Council Room V1 — Phase 2 lightweight room (semantic HTML + CSS + inline SVG).
 *
 * Presentation only. It renders buildRoomModel: current snapshot state and the
 * newest recorded events, each labelled as what it is. The Phase 1 text feed
 * below it stays the canonical record. No controls, no idle animation, no voice.
 */
import { utcStamp } from "@/lib/desk/display-evidence";
import { LAYER_LABEL } from "@/lib/desk/council-room-narration";
import { SNAPSHOT_PHASE_LABEL, type RoomModel, type RoomTile, type SeatRead } from "@/lib/desk/council-room-lite";

const READ_TEXT: Record<SeatRead, string> = { UP: "UP", DOWN: "DOWN", WAIT: "WAIT", unknown: "unknown" };

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

/** Open circle = seat read (research, current state). Dashed when unknown. */
function SeatMark({ read }: { read: SeatRead }) {
  const unknown = read === "unknown";
  return (
    <svg className="room-lite-mark" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray={unknown ? "2 2" : undefined} />
      {read === "UP" ? <path d="M8 4.5 L11 9.5 H5 Z" fill="currentColor" /> : null}
      {read === "DOWN" ? <path d="M8 11.5 L11 6.5 H5 Z" fill="currentColor" /> : null}
      {read === "WAIT" ? <path d="M5 8 H11" stroke="currentColor" strokeWidth="1.5" /> : null}
    </svg>
  );
}

/** Diamond = Chair (SATOSHI). */
function ChairMark({ read }: { read: SeatRead }) {
  return (
    <svg className="room-lite-mark" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <path d="M8 1.5 L14.5 8 L8 14.5 L1.5 8 Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray={read === "unknown" ? "2 2" : undefined} />
    </svg>
  );
}

/** Filled square = recorded paper call; dashed outline when none is in the retained feed. */
function BookMark({ recorded }: { recorded: boolean }) {
  return (
    <svg className="room-lite-mark" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <rect x="3" y="3" width="10" height="10" fill={recorded ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.5" strokeDasharray={recorded ? undefined : "2 2"} />
    </svg>
  );
}

function RecordedLine({ tile, none }: { tile: RoomTile; none: string }) {
  const e = tile.recorded;
  if (!e) return <p className="room-lite-line">Last recorded: {none}</p>;
  return (
    <p className="room-lite-line">
      Last recorded <span className="room-lite-tag">{LAYER_LABEL[e.layer]}</span>{" "}
      <time dateTime={e.recorded_at}>{utcStamp(e.recorded_at)}</time>: {e.text}
    </p>
  );
}

export function CouncilRoomLite({ model }: { model: RoomModel }) {
  const usable = model.snapshotReadMs != null;
  return (
    <section className="room-lite" aria-labelledby="room-lite-title" data-snapshot={model.snapshot}>
      <div className="room-lite-head">
        <div className="font-mono text-micro uppercase tracking-widest text-subtle">Lightweight room · read only</div>
        <h2 id="room-lite-title" className="mt-1 font-sans text-title font-medium">Council room</h2>
      </div>

      <div className="room-lite-status">
        <p role="status" aria-live="polite" aria-atomic="true" data-room-announce="">
          {SNAPSHOT_PHASE_LABEL[model.snapshot]}
        </p>
        <p data-room-clock="">
          {usable ? (
            <>
              Snapshot read <time dateTime={iso(model.snapshotReadMs!)}>{utcStamp(iso(model.snapshotReadMs!))}</time>
              {model.tickAgeS != null ? <> · desk tick age reported {model.tickAgeS}s</> : null}
              {model.window ? <> · window {model.window.ticker}</> : null}
            </>
          ) : (
            "No snapshot values shown."
          )}
        </p>
      </div>

      <div className="room-lite-tiles">
        <article className="room-lite-tile" data-flash={model.chair.flash ? "true" : undefined} aria-labelledby="room-lite-chair">
          <h3 id="room-lite-chair" className="room-lite-tile-title"><ChairMark read={model.chair.current} /> SATOSHI · Chair</h3>
          <p className="room-lite-line">
            Current state <span className="room-lite-tag">snapshot</span>: <strong>{READ_TEXT[model.chair.current]}</strong>
          </p>
          <RecordedLine tile={model.chair} none="no Chair event in the retained feed" />
        </article>

        <article className="room-lite-tile" data-flash={model.book.flash ? "true" : undefined} aria-labelledby="room-lite-book">
          <h3 id="room-lite-book" className="room-lite-tile-title"><BookMark recorded={!!model.book.recorded} /> Paper book</h3>
          <RecordedLine tile={model.book} none="none in retained recorded events · position unknown" />
          <p className="room-lite-note">Shown only from a recorded paper call. Never inferred from a seat read or the Chair&rsquo;s lean.</p>
        </article>

        <article className="room-lite-tile" data-flash={model.integrity.flash ? "true" : undefined} aria-labelledby="room-lite-warden">
          <h3 id="room-lite-warden" className="room-lite-tile-title">WARDEN · Feed integrity</h3>
          <RecordedLine tile={model.integrity} none="no integrity event in the retained feed" />
        </article>

        <article className="room-lite-tile" data-flash={model.lab.flash ? "true" : undefined} aria-labelledby="room-lite-lab">
          <h3 id="room-lite-lab" className="room-lite-tile-title">ALCHEMIST · Lab</h3>
          <RecordedLine tile={model.lab} none="no research event in the retained feed" />
        </article>
      </div>

      <h3 className="room-lite-seats-title" id="room-lite-seats">Current state · seat reads</h3>
      <ul className="room-lite-seats" aria-labelledby="room-lite-seats">
        {model.seats.map((s) => (
          <li key={s.seat} className="room-lite-seat" data-role={s.role} data-read={s.read} data-flash={s.flash ? "true" : undefined}>
            {s.showsVote ? <SeatMark read={s.read} /> : null}
            <span className="room-lite-seat-name">{s.seat}</span>
            <span className="room-lite-seat-read">
              {s.role === "retired" ? "Retired · no vote" : s.role === "pit" ? "Pit crew · no vote" : READ_TEXT[s.read]}
            </span>
          </li>
        ))}
      </ul>

      <p className="room-lite-legend">
        Open circle: seat read (research, current state). Diamond: Chair. Filled square: recorded paper call. Dashed: unknown.
        A tile or seat is outlined only when a newly delivered recorded event names it.
      </p>
      <a href="#exchange-heading" className="room-lite-jump">Jump to recorded exchanges</a>
    </section>
  );
}
