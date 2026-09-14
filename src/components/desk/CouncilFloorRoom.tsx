import { useEffect, useId, useState, type ReactNode } from "react";
import type { Lean } from "@/lib/desk/types";
import { readFloorRoomHidden, setFloorRoomHidden } from "./prefs";

export function CouncilFloorRoom({ lean, children }: { lean: Lean; children: ReactNode }) {
  const [hidden, setHidden] = useState(false);
  const artId = useId();
  useEffect(() => { setHidden(readFloorRoomHidden()); }, []);

  function toggleRoom() {
    const next = !hidden;
    setHidden(next);
    setFloorRoomHidden(next);
  }

  return (
    <section className="council-floor-room" data-lean={lean.toLowerCase()} data-room-hidden={hidden} aria-label="The Council chamber floor">
      <div id={artId} className="council-floor-room-art" aria-hidden="true" hidden={hidden} />
      <div className="council-floor-room-label">
        <span>The Council Floor</span>
        <div className="council-floor-room-controls">
          <span className="council-floor-room-meta" aria-hidden="true">21 stations · Chair center</span>
          <button type="button" className="council-floor-room-toggle" onClick={toggleRoom} aria-expanded={!hidden} aria-controls={artId}>
            {hidden ? "Show room" : "Hide room"}
            <span aria-hidden="true">{hidden ? "+" : "×"}</span>
          </button>
        </div>
      </div>
      <div className="council-floor-room-call">{children}</div>
    </section>
  );
}
