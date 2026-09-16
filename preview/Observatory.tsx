import { useMemo, useState } from "react";
// The preview build selects this export from the unchanged production source.
import { ChairBoard } from "@/components/desk/SatoshiTab";
import { Streamer } from "@/components/atelier/streamer";
import type { Lean } from "@/lib/desk/types";
import { sample } from "./sample";
import { CouncilNavigation } from "@/components/desk/CouncilNavigation";
import { CouncilEntrance, CouncilGuides, CouncilFocusToggle } from "@/components/desk/CouncilExperience";

function Arrow({ diagonal = false }: { diagonal?: boolean }) {
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d={diagonal ? "M6 18 18 6M6 6h12v12" : "M4 12h15m-6-6 6 6-6 6"} stroke="currentColor" strokeWidth="1.5" /></svg>;
}


export function Observatory() {
  const params = new URLSearchParams(location.search);
  const initialLean: Lean = params.get("call") === "UP" ? "UP" : params.get("call") === "DOWN" ? "DOWN" : "WAIT";
  const [lean, setLean] = useState<Lean>(initialLean);
  const [focus, setFocus] = useState(false);
  const [surface, setSurface] = useState<"floor" | "broadcast">("floor");
  const data = useMemo(() => sample(lean), [lean]);
  const quorum = data.chair.quorum;
  const total = quorum.up + quorum.down + quorum.wait;

  return <div className="observatory" data-focus={focus} data-lean={lean.toLowerCase()}>
    <a className="obs-skip" href="#council-floor">Skip to the Council call</a>
    <div className="obs-preview-banner"><span className="obs-status-dot" /> DESIGN CONCEPT 02 <span className="obs-banner-divider">/</span> SYNTHETIC DATA · NOT A LIVE CALL</div>
    <CouncilNavigation pathname="/" preview />
    <div className="obs-container obs-preview-navigation-note"><p>Full-site navigation restored. Room links open the current site in a new tab; this page stays a demo.</p><CouncilFocusToggle focused={focus} onToggle={() => setFocus(value => !value)} /></div>

    {!focus && <CouncilEntrance />}

    <main className="obs-container obs-main">
      <section className="obs-floor" id="council-floor" tabIndex={-1} aria-labelledby="obs-floor-title">
        <div className="obs-floor-heading">
          <div><p className="obs-eyebrow">THE DECISION DESK</p><h2 id="obs-floor-title">The Council floor<span>.</span></h2></div>
          <div className="obs-view-switch" aria-label="Floor presentation">
            <button type="button" aria-pressed={surface === "floor"} onClick={() => setSurface("floor")}>Chamber</button>
            <button type="button" aria-pressed={surface === "broadcast"} onClick={() => setSurface("broadcast")}>Broadcast <Arrow diagonal /></button>
          </div>
        </div>
        <div className="obs-market-strip">
          <div><span className="obs-bitcoin" aria-hidden="true">₿</span><strong>BITCOIN</strong><span className="obs-market-window">15 MINUTE WINDOW</span></div>
          <span className="obs-demo"><span className="obs-status-dot" /> DEMO · PAPER ONLY</span>
        </div>
        {surface === "floor" ? <div className="obs-desk-grid">
          <div className="obs-call">
            <div className="obs-call-overline"><span>THE CHAIR’S PERSPECTIVE</span><span>SAMPLE / {lean}</span></div>
            <ChairBoard snap={data.snapshot} chair={data.chair} tz="UTC" callLog={[]} density="quiet" />
            <div className="obs-call-note"><span aria-hidden="true">◇</span> A paper research read, not an instruction to trade. No outcome is guaranteed.</div>
          </div>
          <aside className="obs-council" aria-label="Sample Council composition">
            <div className="obs-council-top"><div><p className="obs-eyebrow">BEHIND THE CALL</p><h3>A room of<br />different perspectives.</h3></div><span className="obs-counter">21<small>STATIONS</small></span></div>
            <div className="obs-seat-map" aria-hidden="true">{Array.from({ length: 21 }, (_, index) => <i key={index} data-voting={index < total} />)}</div>
            <div className="obs-quorum-title"><span>Sample voting quorum</span><strong>{total} seats</strong></div>
            <div className="obs-quorum-bar" aria-hidden="true"><i data-tone="up" style={{ flex: quorum.up }} /><i data-tone="down" style={{ flex: quorum.down }} /><i data-tone="wait" style={{ flex: quorum.wait }} /></div>
            <dl className="obs-votes"><div data-tone="up"><dt>UP</dt><dd>{quorum.up.toString().padStart(2, "0")}</dd></div><div data-tone="down"><dt>DOWN</dt><dd>{quorum.down.toString().padStart(2, "0")}</dd></div><div data-tone="wait"><dt>WAIT</dt><dd>{quorum.wait.toString().padStart(2, "0")}</dd></div></dl>
            <p className="obs-quorum-note">21 stations does not mean 21 votes. The voting quorum and supporting research have different jobs.</p>
            <details className="obs-path"><summary>How a reading becomes a call <Arrow /></summary><ol><li><b>Observe</b><span>Specialists read different parts of the market.</span></li><li><b>Challenge</b><span>Voting seats, prices and safety gates shape the decision.</span></li><li><b>Decide</b><span>The Chair shows UP, DOWN or WAIT. A paper fill is recorded separately.</span></li></ol></details>
          </aside>
        </div> : <div className="obs-broadcast atelier" data-room="streamer"><div className="atelier-stage"><Streamer satoshi={data.paint} concept={false} /></div></div>}
        <div className="obs-desk-footer"><span><i /> SYNTHETIC DISPLAY FIXTURE</span><span>No live feed. No orders. No saved results.</span></div>
      </section>

      {!focus && <CouncilGuides />}

      <section className="obs-principle" aria-label="Research principle"><span className="obs-principle-mark" aria-hidden="true">◇</span><div><p className="obs-eyebrow">THE COUNCIL’S PRINCIPLE</p><p>A clear WAIT is worth more than a forced call.</p></div><span className="obs-principle-note">Research is a process.<br />Certainty is not the promise.</span></section>
      <details className="obs-inspector"><summary>Preview controls <span>DESIGN TOOLS <span aria-hidden="true">＋</span></span></summary><div className="obs-inspector-content"><label>Sample call<select value={lean} onChange={event => setLean(event.target.value as Lean)}><option>WAIT</option><option>UP</option><option>DOWN</option></select></label><p>All values are invented for design review. Changing the sample does not run the Council engine or save a result.</p><a href="/?qa=1">Responsive comparison <Arrow diagonal /></a></div></details>
    </main>
    <footer className="obs-footer obs-container"><a href="#" className="obs-footer-brand">SATOSHI’S COUNCIL</a><span>CONCEPT 02 · THE OBSERVATORY</span><span>Independent research. Not financial advice.</span></footer>
  </div>;
}
