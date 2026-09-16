import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
// Export selected directly from the source by the isolated preview build plugin.
import { ChairBoard } from "@/components/desk/SatoshiTab";
import { CouncilFloorRoom } from "@/components/desk/CouncilFloorRoom";
import { Streamer } from "@/components/atelier/streamer";
import type { Lean } from "@/lib/desk/types";
import { sample } from "./sample";
import "./tailwind.css";
import "./preview.css";

declare const __PREVIEW_COMMIT__: string;

function ComponentPreview() {
  const params = new URLSearchParams(location.search);
  const lean: Lean = params.get("call") === "UP" ? "UP" : params.get("call") === "DOWN" ? "DOWN" : "WAIT";
  const density = params.get("view") === "full" ? "full" : "quiet";
  const data = useMemo(() => sample(lean), [lean]);
  return <>
    <div className="preview-notice">DESIGN PREVIEW · SYNTHETIC DATA · NOT A LIVE CALL</div>
    {params.get("view") === "streamer" ? (
      <div className="atelier" data-room="streamer"><div className="atelier-stage">
        <Streamer satoshi={data.paint} concept={false} />
      </div></div>
    ) : (
      <main className="preview-floor gutter mx-auto max-w-[var(--max)]">
        <CouncilFloorRoom lean={lean} density={density}>
          <ChairBoard snap={data.snapshot} chair={data.chair} tz="UTC" callLog={[]} density={density} />
        </CouncilFloorRoom>
      </main>
    )}
  </>;
}

function PreviewControls() {
  const [view, setView] = useState("quiet");
  const [lean, setLean] = useState("WAIT");
  const [width, setWidth] = useState("1280");
  const query = new URLSearchParams({ embedded: "1", view, call: lean });
  return <main className="preview-shell">
    <header className="preview-header">
      <div><p className="preview-kicker">SATOSHI’S COUNCIL · DESIGN QA</p>
        <h1>Clearer calls. A quieter floor.</h1>
        <p>Demo data only. No accounts, API keys, database, analytics or trading connections.</p>
      </div>
      <a href="https://github.com/phillyfreak2499-lgtm/Satoshi-s-Council/pull/231" target="_blank" rel="noreferrer">Review PR #231 ↗</a>
    </header>
    <div className="preview-controls">
      <label>View<select value={view} onChange={event => setView(event.target.value)}>
        <option value="quiet">Quiet Floor</option><option value="full">Full Floor</option><option value="streamer">Streamer</option>
      </select></label>
      <label>Sample call<select value={lean} onChange={event => setLean(event.target.value)}>
        <option>WAIT</option><option>UP</option><option>DOWN</option>
      </select></label>
      <label>Viewport<select value={width} onChange={event => setWidth(event.target.value)}>
        <option value="1280">Desktop · 1280px</option><option value="820">Tablet · 820px</option>
        <option value="390">Mobile · 390px</option><option value="320">Small mobile · 320px</option>
      </select></label>
      <span className="preview-version">Source {__PREVIEW_COMMIT__.slice(0, 7)}</span>
    </div>
    <div className="preview-canvas">
      <iframe key={query.toString()} title="Component preview" src={`/?${query}`} width={width} height="1250" />
    </div>
    <p className="preview-footnote">This is an isolated component preview, not the live site. All displayed market readings are synthetic.</p>
  </main>;
}

createRoot(document.getElementById("root")!).render(
  new URLSearchParams(location.search).has("embedded") ? <ComponentPreview /> : <PreviewControls />,
);
