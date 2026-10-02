import { availabilityLine } from "@/lib/desk/council-public";
import { useEffect } from "react";
import { useDesk } from "@/lib/desk/store";
import { useCountdownText } from "@/lib/desk/hooks";
import { clockMs } from "@/lib/desk/math";
import { bookState } from "@/lib/desk/book-floor";
import { plainLine } from "@/lib/desk/chair-words";
import { SHOP_URL } from "@/lib/desk/navigation";
import { beacon } from "@/lib/desk/beacon";
import { GlobalHeader } from "./GlobalHeader";
import { CouncilGuides } from "./CouncilExperience";
import { LiveConnectionNotice } from "./LiveConnectionNotice";
import { HomeStill } from "./HomeStill";
import { PaperDisclaimer } from "./PaperDisclaimer";
import { CanonicalRecord } from "./CanonicalRecord";
import { AlertsPanel } from "./AlertsPanel";
import { WaitResearchNote } from "./WaitResearchNote";
import { applyDisplayPrefs } from "./prefs";
import { utcStamp } from "@/lib/desk/display-evidence";
import type { Books, BooksWindow } from "@/lib/desk/books";
import { lastWindowFact } from "@/lib/desk/home-still";
import "./hero-chip.css";

/** The public introduction reads the same shared frame as the full desk. */
export function CouncilHome({ last = null, books = null, fill = null }: { last?: BooksWindow | null; books?: Books | null; fill?: BooksWindow | null }) {
  const frame = useDesk();
  const { snap, chair } = frame;
  const ticking = useCountdownText(snap?.close_time ?? 0);
  const countdown = ticking === "—" && snap ? clockMs(Math.max(0, snap.close_time - snap.as_of)) : ticking;
  const book = snap && chair ? bookState(snap, chair.lean, frame.call_log) : null;
  const demo = frame.settings.source === "demo";
  const still = book !== null && book.kind !== "booked" && lastWindowFact(last) !== null;
  const currentRead = chair?.lean ?? "CONNECTING";
  const paperPosition = book?.kind === "booked"
    ? `${book.source === "RECOVERY_FAV85_V1" ? "RECOVERY PILOT · " : ""}${book.lean} @ ${book.cents.toFixed(1)}¢`
    : book ? "NONE" : "—";
  const operationalDead = frame.operational?.state === "DEAD";
  const statusLine = operationalDead
    ? "Feed/data outage — not a WAIT"
    : !snap || !chair
      ? "Connecting to live data — not a WAIT"
      : chair.lean === "WAIT"
        ? "WAIT is an intentional sit, not an outage"
        : "Directional research read is live";
  const freshnessLine = snap
    ? `${snap.ticker} · updated ${new Date(snap.as_of).toISOString().slice(11, 19)} UTC`
    : "Waiting for the next live snapshot";
  useEffect(() => { applyDisplayPrefs(); }, []);
  return <div className="council-home observatory">
    <a href="#home-main" className="skip-link">Skip to content</a>
    <GlobalHeader />
    <main id="home-main">
      <section className="company-hero" aria-labelledby="home-title">
        <div className="company-hero-art" aria-hidden="true"><img src="/floor/council-chamber-v1.webp" width="1672" height="941" alt="" fetchPriority="high" /></div>
        <div className="company-container company-hero-inner">
          <p className="company-eyebrow">Independent Bitcoin research · Paper only</p>
          <h1 id="home-title">Bitcoin every 15 minutes.<br /><em>Every paper call gets graded.</em></h1>
          <p className="company-hero-lede">This desk studies each 15-minute Bitcoin window, records hypothetical positions at the actual ask and fee, then checks the official result. It never trades.</p>
          <p className="company-hero-chip">Public prices · No live orders · Not affiliated with Kalshi.</p>
          <div className="company-hero-live" aria-label="Current research state">
            <div className="company-hero-live-item">
              <span>Chair read</span>
              <strong className="company-hero-live-call" data-lean={chair?.lean.toLowerCase()}>{currentRead}</strong>
            </div>
            <div className="company-hero-live-item">
              <span>Paper position</span>
              <strong>{paperPosition}</strong>
            </div>
            <div className="company-hero-live-item company-hero-live-meta">
              <span>Status / freshness</span>
              <strong>{statusLine}</strong>
              <small>{freshnessLine}</small>
            </div>
          </div>
          <div className="company-actions">
            <a href="/desk?view=guided" onClick={() => beacon("home_guided_click")} className="company-button">New here · Guided Floor <span aria-hidden="true">↗</span></a>
            <a href="/desk?view=pro" onClick={() => beacon("home_pro_click")} className="company-button company-button-outline">Returning · Pro Floor <span aria-hidden="true">↗</span></a>
          </div>
          <p className="company-hero-doors company-hero-doors-note">Guided and Pro show the same live window and the same Chair decision. Pro only exposes more of the working.</p>
          <p className="company-hero-note">
            <a href="/books" onClick={() => beacon("results_open")} className="company-text-link">View every graded paper call <span aria-hidden="true">→</span></a>
            <span aria-hidden="true"> · </span>
            <a href="#call-alerts" className="company-text-link">Paper call alerts <span aria-hidden="true">→</span></a>
          </p>
        </div>
      </section>
      <div className="company-container">
        <LiveConnectionNotice frame={frame} />
        <section className="company-live" aria-labelledby="home-live-title">
          <div className="company-live-decision">
            <p className="company-eyebrow" id="home-live-title">{demo ? "Demo preview" : "Current Chair read"}</p>
            <div className="company-live-call" data-lean={chair?.lean.toLowerCase()}>{chair?.lean ?? "Connecting"}</div>
            <span className="company-muted"><strong>Paper position:</strong> {book?.kind === "booked" ? `${book.source === "RECOVERY_FAV85_V1" ? "Recovery pilot · " : ""}${book.lean} · ${book.cents.toFixed(1)}¢ entry` : book ? "NONE · no paper position booked" : "—"}</span>
          </div>
          <div className="company-live-context"><p>{availabilityLine(chair?.rows ?? [])}</p><p>{snap && chair && book ? plainLine(chair, snap, book) : "The latest Council snapshot will appear here when the research feed connects."}</p>{still ? <HomeStill last={last} fill={fill} /> : null}<a href="/desk" className="company-text-link">Read the full decision <span aria-hidden="true">→</span></a></div>
          {snap ? (
            <dl className="company-live-numbers"><div><dt>Bitcoin spot</dt><dd>{new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(snap.spot)}</dd></div><div><dt>Window closes in</dt><dd>{countdown}</dd></div></dl>
          ) : (
            <p className="company-muted">Waiting for the next window. The feed reconnects on its own.</p>
          )}
        </section>
        {!demo && chair?.lean === "WAIT" && book?.kind !== "booked" ? <div className="mt-4"><WaitResearchNote /></div> : null}
        <div className="mt-4"><CanonicalRecord books={books} compact /></div>
        <section id="call-alerts" className="mt-4 scroll-mt-24" aria-label="Paper call notifications">
          <p className="mb-2 font-sans text-ui text-muted">You can leave the Floor. Turn on a browser alert for SATOSHI’s next booked UP or DOWN paper call; quiet WAIT windows send nothing.</p>
          <AlertsPanel />
        </section>
        <p className="company-snapshot">
          {snap ? <>{demo ? "Simulated data" : "Snapshot"} · {new Date(snap.as_of).toISOString().slice(11, 19)} UTC · </> : null}
          {last && !still ? <>Last graded window · <a href={`/window/${encodeURIComponent(last.ticker)}`}>{utcStamp(last.close_time)}</a> settled {last.winner}{last.call ? ` · ${last.call.source === "RECOVERY_FAV85_V1" ? "recovery pilot" : "paper"} ${last.call.lean ?? "position"} at ${last.call.entry.toFixed(0)}¢, ${last.call.ev == null ? "not yet graded" : `${last.call.ev > 0 ? "+" : ""}${last.call.ev.toFixed(1)}¢ after fee`}` : " · the desk sat"} · </> : null}
          A Chair read, a booked paper position, and a feed/data outage are three different states.
        </p>
        <section className="company-method" aria-labelledby="method-title">
          <div className="company-section-heading"><div><p className="company-eyebrow">The process</p><h2 id="method-title">Every call has a case.<br /><em>Every result has a record.</em></h2></div><a href="/about" className="company-text-link">How it works <span aria-hidden="true">↗</span></a></div>
          <div className="company-process-grid">
            <article><span className="company-step">01 / Observe</span><h3>See the whole picture.</h3><p>Specialist seats read price structure, order flow, derivatives, market odds, and context.</p><a href="/?tab=structure">Explore the specialists <span aria-hidden="true">→</span></a></article>
            <article><span className="company-step">02 / Decide</span><h3>Know when to wait.</h3><p>SATOSHI brings the evidence together. A directional read must also clear the paper book’s price and safety rules.</p><a href="/desk">Open the floor <span aria-hidden="true">→</span></a></article>
            <article><span className="company-step">03 / Review</span><h3>Let the record speak.</h3><p>Review recorded paper positions, fees, settlement results, and the experiments being tested alongside them.</p><a href="/books" onClick={() => beacon("results_open")}>Open the results <span aria-hidden="true">↗</span></a></article>
          </div>
        </section>
        <CouncilGuides />
        <section className="company-explore" aria-labelledby="explore-title">
          <div className="company-section-heading"><div><p className="company-eyebrow">Go deeper</p><h2 id="explore-title">The work behind the call.</h2></div></div>
          <div className="company-editorial-grid">
            <a href="/training/wick" className="company-editorial-card">
              <span className="visual-guide-media visual-guide-media--portrait visual-guide-media--wick" aria-hidden="true">
                <img className="visual-guide-image visual-guide-image--backdrop" src="/floor/guides/wick.png" alt="" loading="lazy" />
                <img className="visual-guide-image visual-guide-image--subject" src="/floor/guides/wick.png" alt="" loading="lazy" />
              </span>
              <span className="company-eyebrow">Training / WICK</span><h3>Practice the candle read.</h3><p>Study closed candles with WICK. Training is practice, separate from the Council’s paper book.</p><span className="company-card-link">Open training ↗</span>
            </a>
            <a href="/lab" className="company-editorial-card">
              <span className="visual-guide-media visual-guide-media--portrait visual-guide-media--satoshi" aria-hidden="true">
                <img className="visual-guide-image visual-guide-image--backdrop" src="/floor/guides/satoshi.png" alt="" loading="lazy" />
                <img className="visual-guide-image visual-guide-image--subject" src="/floor/guides/satoshi.png" alt="" loading="lazy" />
              </span>
              <span className="company-eyebrow">Research / The Lab</span><h3>Evidence before<br />improvement.</h3><p>Follow prospective experiments and compare candidates against a frozen control.</p><span className="company-card-link">Explore the research <span aria-hidden="true">↗</span></span>
            </a>
            <a href="/about" className="company-editorial-card">
              <span className="visual-guide-media visual-guide-media--scene" aria-hidden="true">
                <img className="visual-guide-image visual-guide-image--scene" src="/floor/council-chamber-v1.webp" alt="" loading="lazy" />
              </span>
              <span className="company-eyebrow">Council / The story</span><h3>Understand<br />the desk.</h3><p>Read how specialist research, SATOSHI’s decision, and the paper record fit together.</p><span className="company-card-link">Open the story <span aria-hidden="true">↗</span></span>
            </a>
          </div>
        </section>
        <section className="company-shop" aria-labelledby="shop-title"><div><p className="company-eyebrow">The Council collection</p><h2 id="shop-title">Stillness is a decision.</h2><p>The ideas behind the floor, made to wear and keep.</p></div><a href={SHOP_URL} target="_blank" rel="noopener noreferrer" className="company-button company-button-outline" aria-label="Visit the shop (opens in a new tab)">Visit the shop <span aria-hidden="true">↗</span></a></section>
      </div>
    </main>
    <PaperDisclaimer />
  </div>;
}
