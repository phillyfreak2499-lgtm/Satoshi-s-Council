import "./observatory.css";

function Arrow({ diagonal = false }: { diagonal?: boolean }) {
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d={diagonal ? "M6 18 18 6M6 6h12v12" : "M4 12h15m-6-6 6 6-6 6"} stroke="currentColor" strokeWidth="1.5" /></svg>;
}


const guides = [
  { name: "Satoshi", title: "The considered call.", image: "satoshi", role: "The Chair", text: "One place to read the decision, its price, and the reasoning behind it.", detail: "The Chair brings the voting seats together. A directional read is not the same as a booked paper position: the price, rules and recorded fill still matter." },
  { name: "Wick", title: "Context, made clear.", image: "wick", role: "The guide", text: "Learn what the market is showing, without decoding an entire trading terminal.", detail: "The guided floor explains the current window in plain language. Open the evidence when you want the underlying prices, timestamps and calculation instead." },
  { name: "The Warden", title: "Restraint is a decision.", image: "warden", role: "The guardrails", text: "Fresh inputs. Clear rules. And the discipline to say WAIT when the case is not there.", detail: "Data quality, market quotes and safety gates can prevent a paper call. Those checks reduce avoidable errors; they cannot eliminate losses or make a forecast certain." },
];


/** Presentation only. No market reads, calls, storage or network requests. */
export function CouncilEntrance({ onTour, onEnter }: { onTour?: () => void; onEnter?: () => void }) {
  return <section className="obs-hero" aria-labelledby="obs-title">
      <div className="obs-hero-art" aria-hidden="true"><img src="/floor/council-chamber-v1.webp" width="1672" height="941" alt="" fetchPriority="high" /></div>
      <div className="obs-orbits" aria-hidden="true"><i /><i /><i /><span className="obs-orbit-point" /></div>
      <div className="obs-hero-content obs-container">
        <p className="obs-eyebrow"><span /> BITCOIN RESEARCH, IN PERSPECTIVE</p>
        <h2 id="obs-title" className="obs-hero-title">A council of minds.<br /><em>One considered call.</em></h2>
        <p className="obs-hero-description">Many perspectives. A clear 15-minute view.<br className="obs-desktop-break" /> Follow the call, understand the reasoning,<br className="obs-desktop-break" /> and know when the Council waits.</p>
        <div className="obs-hero-actions">
          <a className="obs-primary" href="#chair-stage" onClick={onEnter}>Enter the floor <Arrow /></a>
          <a className="obs-text-link" href="#the-method">Meet the Council <Arrow diagonal /></a>
          {onTour ? <button type="button" className="obs-text-link" onClick={onTour}>60-second tour</button> : null}
        </div>
        <div className="obs-hero-caption" aria-hidden="true"><span>THE CHAMBER</span><b>Different lenses. Shared discipline.</b><i /></div>
      </div>
      <div className="obs-hero-bottom obs-container"><span>INDEPENDENT PERSPECTIVES. ONE PLACE TO LOOK.</span><span>01 — THE OBSERVATORY</span></div>
    </section>;
}

export function CouncilGuides() {
  return <section className="obs-method" id="the-method" aria-labelledby="obs-method-title">
        <div className="obs-method-heading"><div><p className="obs-eyebrow">THE THINKING BEHIND THE FLOOR</p><h2 id="obs-method-title">Conviction needs <em>context.</em></h2></div><p>Not more noise. A clearer way to see<br className="obs-desktop-break" /> what matters, and what does not.</p></div>
        <div className="obs-guide-grid">{guides.map((guide, index) => <article className="obs-guide" key={guide.name}>
          <div className="obs-guide-art"><span className="obs-guide-number">0{index + 1}</span><div className="obs-guide-halo" /><img src={`/floor/guides/${guide.image}.png`} width="512" height="512" alt={`${guide.name}, a stylized Council character`} loading="lazy" /></div>
          <div className="obs-guide-copy"><p className="obs-eyebrow">{guide.name} <span>/</span> {guide.role}</p><h3>{guide.title}</h3><p>{guide.text}</p><details><summary>Explore the role <Arrow diagonal /></summary><p>{guide.detail}</p></details></div>
        </article>)}</div>
      </section>;
}

/** Focus hides the entrance and guide art, never navigation or research panels. */
export function CouncilFocusToggle({ focused, onToggle }: { focused: boolean; onToggle: () => void }) {
  return <button type="button" className="obs-focus" aria-pressed={focused} onClick={onToggle}>
    <span className="obs-focus-icon" aria-hidden="true" />{focused ? "Show entrance" : "Focus mode"}
  </button>;
}
