/**
 * Council Room V1 — 2.5D chamber (CR-CLAUDE-004). Contract: docs/COUNCIL_ROOM_V1.md §10.
 *
 * Presentation only. Layered HTML/CSS planes with a bounded drag and a subtle
 * drift; each cast member is a button that opens two separate sections:
 * recorded activity (retained feed events) and the current snapshot. It reads
 * the same feed and room model as the lightweight room. No polling, no network,
 * no audio. SCAFFOLD: the planes are plain CSS shapes until the approved art
 * manifest (CR-GROK-002) lands; no generated or substitute art.
 */
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { utcStamp } from "@/lib/desk/display-evidence";
import { LAYER_LABEL } from "@/lib/desk/council-room-narration";
import type { FeedEvent, FeedState } from "@/lib/desk/council-room-feed";
import { SNAPSHOT_PHASE_LABEL, type RoomModel } from "@/lib/desk/council-room-lite";
import {
  CAST,
  classifyPress,
  clampOffset,
  layerOffset,
  memberPanel,
  motionMode,
  nudge,
  type CastId,
  type CastMember,
  type MemberPanel,
  type Offset,
} from "@/lib/desk/council-room-parallax";

export const MOTION_PAUSE_LABEL = "Pause motion";
export const MOTION_RESUME_LABEL = "Resume motion";

const ARRIVAL_TEXT: Record<FeedEvent["arrival"], string> = { history: "History", fresh: "New", live: "Received live", late: "Arrived late" };
const READ_TEXT = { UP: "UP", DOWN: "DOWN", WAIT: "WAIT", unknown: "unknown" } as const;

function useMedia(query: string): boolean {
  const [match, setMatch] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const m = window.matchMedia(query);
    const sync = () => setMatch(m.matches);
    sync();
    m.addEventListener("change", sync);
    return () => m.removeEventListener("change", sync);
  }, [query]);
  return match;
}

/** Parallax offset as CSS variables; the stylesheet composes them with each layer's own transform. */
function planeStyle(o: Offset, depth: CastMember["depth"]): CSSProperties {
  const v = layerOffset(o, depth);
  return { "--px": `${v.x}px`, "--py": `${v.y}px` } as CSSProperties;
}

export function MemberDetail({ panel, onClose }: { panel: MemberPanel; onClose?: () => void }) {
  const { member, recorded, recordedBy, snapshot } = panel;
  const headingId = `room-px-detail-${member.id}`;
  return (
    <div className="room-px-detail" role="region" aria-labelledby={headingId} data-member={member.id}>
      <div className="room-px-detail-head">
        <h3 id={headingId} tabIndex={-1} className="room-px-detail-title">
          {member.id} · {member.role}
        </h3>
        {onClose ? (
          <button type="button" className="room-px-close" onClick={onClose}>
            Close
          </button>
        ) : null}
      </div>

      <section aria-label={`Recorded activity for ${member.id}`} data-section="recorded">
        <h4 className="room-px-sub">Recorded activity</h4>
        {recordedBy ? <p className="room-px-note">{member.id} does not speak in the event log. Its activity is what {recordedBy} recorded about it.</p> : null}
        {recorded.length ? (
          <ol className="room-px-events">
            {recorded.map((e) => (
              <li key={e.event_id} data-arrival={e.arrival}>
                <span className="room-px-tag">{LAYER_LABEL[e.layer]}</span> <span className="room-px-tag">{ARRIVAL_TEXT[e.arrival]}</span>{" "}
                <time dateTime={e.recorded_at}>recorded {utcStamp(e.recorded_at)}</time>: {e.text}
              </li>
            ))}
          </ol>
        ) : (
          <p className="room-px-line">No recorded event for {member.id} in the retained feed.</p>
        )}
      </section>

      <section aria-label={`Current snapshot for ${member.id}`} data-section="snapshot">
        <h4 className="room-px-sub">Current snapshot · not a recorded event</h4>
        {snapshot.kind === "none" ? (
          <p className="room-px-line">{snapshot.reason}</p>
        ) : (
          <>
            <p className="room-px-line">{SNAPSHOT_PHASE_LABEL[snapshot.phase]}</p>
            <p className="room-px-line">
              {snapshot.kind === "chair" ? "Chair current state" : snapshot.showsVote ? "Seat read" : "Pit crew · no vote"}
              {snapshot.kind === "chair" || snapshot.showsVote ? <>: <strong>{READ_TEXT[snapshot.read]}</strong></> : null}
              {snapshot.readMs != null ? <> · snapshot read <time dateTime={new Date(snapshot.readMs).toISOString()}>{utcStamp(new Date(snapshot.readMs).toISOString())}</time></> : null}
            </p>
            {snapshot.kind === "seat" ? <p className="room-px-line">{snapshot.availability}</p> : null}
          </>
        )}
      </section>
    </div>
  );
}

export function CouncilRoomParallax({ feed, room, initialSelected = null }: { feed: FeedState; room: RoomModel; initialSelected?: CastId | null }) {
  const reducedMotion = useMedia("(prefers-reduced-motion: reduce)");
  const narrow = useMedia("(max-width: 719px)");
  const [motionPaused, setMotionPaused] = useState(false);
  const [offset, setOffset] = useState<Offset>({ x: 0, y: 0 });
  const [selected, setSelected] = useState<CastId | null>(initialSelected);
  const press = useRef<{ start: Offset; base: Offset; id: number } | null>(null);
  const suppressClick = useRef(false);
  const returnFocus = useRef<HTMLButtonElement | null>(null);
  const mode = motionMode({ reducedMotion, motionPaused, narrow });
  const live = mode === "live";
  const view = live ? offset : { x: 0, y: 0 };

  useEffect(() => {
    if (selected) document.getElementById(`room-px-detail-${selected}`)?.focus();
  }, [selected]);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    suppressClick.current = false;
    if (!live || e.button !== 0) return;
    press.current = { start: { x: e.clientX, y: e.clientY }, base: offset, id: e.pointerId };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const p = press.current;
    if (!p || p.id !== e.pointerId) return;
    const now = { x: e.clientX, y: e.clientY };
    if (classifyPress(p.start, now) === "drag") {
      suppressClick.current = true;
      setOffset(clampOffset({ x: p.base.x + now.x - p.start.x, y: p.base.y + now.y - p.start.y }));
    }
  };
  const onPointerEnd = (e: PointerEvent<HTMLDivElement>) => {
    const p = press.current;
    if (p && p.id === e.pointerId && classifyPress(p.start, { x: e.clientX, y: e.clientY }) === "drag") suppressClick.current = true;
    press.current = null;
  };
  const onStageKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || !live) return;
    const next = nudge(offset, e.key);
    if (next) {
      e.preventDefault();
      setOffset(next);
    }
  };
  const open = (id: CastId, el: HTMLButtonElement) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    returnFocus.current = el;
    setSelected(id);
  };
  const close = () => {
    setSelected(null);
    returnFocus.current?.focus();
  };

  const panels = CAST.map((m) => memberPanel(feed, room, m));
  const current = selected ? panels.find((p) => p.member.id === selected) ?? null : null;

  return (
    <section className="room-px" aria-labelledby="room-px-title" data-motion={mode} data-snapshot={room.snapshot}>
      <div className="room-px-head">
        <div className="font-mono text-micro uppercase tracking-widest text-subtle">2.5D chamber · read only · scaffold art</div>
        <h2 id="room-px-title" className="mt-1 font-sans text-title font-medium">Council chamber</h2>
        <button type="button" className="room-px-motion" onClick={() => setMotionPaused((v) => !v)}>
          {motionPaused ? MOTION_RESUME_LABEL : MOTION_PAUSE_LABEL}
        </button>
        <p className="room-px-note" data-motion-note="">
          {reducedMotion ? "Motion is off: your system asks for reduced motion." : narrow ? "Static layout on small screens." : motionPaused ? "Motion paused by you. Live updates are separate." : "Drag or use arrow keys on the stage to look around. Home resets."}
        </p>
      </div>

      <div
        className="room-px-stage"
        role="group"
        aria-label="Chamber stage. Select a member to open their recorded activity and current snapshot."
        tabIndex={live ? 0 : -1}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onKeyDown={onStageKey}
      >
        <div className="room-px-plane room-px-back" style={planeStyle(view, 0)} aria-hidden="true" />
        <div className="room-px-plane room-px-stations" style={planeStyle(view, 1)} aria-hidden="true" />
        <ul className="room-px-cast" aria-label="Cast members">
          {panels.map((p) => (
            <li key={p.member.id} className="room-px-slot" data-depth={p.member.depth} style={{ left: `${p.member.x}%`, top: `${p.member.y}%`, ...planeStyle(view, p.member.depth) }}>
              <button
                type="button"
                className="room-px-member"
                data-member={p.member.id}
                data-flash={p.flash ? "true" : undefined}
                aria-expanded={selected === p.member.id}
                onClick={(e) => open(p.member.id, e.currentTarget)}
              >
                <span className="room-px-figure" aria-hidden="true" />
                <span className="room-px-name">{p.member.id}</span>
                <span className="room-px-role">{p.member.role}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      {current ? <MemberDetail panel={current} onClose={close} /> : null}
    </section>
  );
}
