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
import { ReadFillPair } from "./ReadFillPair";
import { applyDisplayPrefs } from "./prefs";
import { utcStamp } from "@/lib/desk/display-evidence";
import type { Books, BooksWindow } from "@/lib/desk/books";
import { lastWindowFact } from "@/lib/desk/home-still";
import "./hero-chip.css";

/** The public introduction reads the same shared frame as the full desk. */
export function CouncilHome({ last = null, books = null }: { last?: BooksWindow | null; books?: Books | null }) {
  const frame = useDesk();
  const { snap, chair } = frame;
  const ticking = useCountdownText(snap?.close_time ?? 0);
  const countdown = ticking === "—" && snap ? clockMs(Math.max(0, snap.close_time - snap.as_of)) : ticking;
  const book = snap && chair ? bookState(snap, chair.lean, frame.call_log) : null;
  const demo = frame.settings.source === "demo";
  const still = book !== null && book.kind !== "booked" && lastWindowFact(last) !== null;
  useEffect(() => { applyDisplayPrefs(); }, []);
  return <div className="council-home observatory">
    <a href="#home-main" className="skip-link">Skip to content</a>
    <GlobalHeader />
    <main id="home-main">
      <section className="company-hero" aria-labelledby="home-title">
        <div className="company-hero-art" aria-hidden="true"><img src="/floor/council-chamber-v1.webp" width="1672" height="941" alt="" fetchPriority="high" /></div>
        <div className="company-container company-hero-inner">
          <p className="company-eyebrow">Independent Bitcoin research</p>
          <h1 id="home-title">A clearer view.<br /><em>A considered call.</em></h1>
          <p className="company-hero-chip">Paper research. Public prices. No live orders. · Not affiliated with Kalshi.</p>
          <p className="company-hero-lede">Follow the Council as it weighs Bitcoin’s next 15 minutes. See the decision, explore the evidence, and judge the record for yourself.</p>
          <div className="company-actions">
            <a href="/desk?view=guided" onClick={() => beacon("home_guided_click")} className="company-button">Start with Guided Floor <span aria-hidden="true">↗</span></a>
            <a href="/desk?view=pro" onClick={() => beacon("home_pro_click")} className="company-button company-button-outline">Open Pro Floor <span aria-hidden="true">↗</span></a>
          </div>
          <p className="company-hero-note">
            <a href="/training/wick" className="company-text-link">Start with WICK <span aria-hidden="true">→</span></a>
          </p>
          <p className="company-hero-doors">
            <span><strong>Guided Floor</strong> — New here? See the Council’s live decision in plain English.</span>
            <span><strong>Pro Floor</strong> — Full evidence, prices, model, gates and diagnostics.</span>
            <span className="company-hero-doors-note">Both are the same live window and the same call; Pro simply shows more of the working.</span>
          </p>
        </div>
      </section>
      <div className="company-container">
        <LiveConnectionNotice frame={frame} />
        <section className="company-live" aria-labelledby="home-live-title">
          <div className="company-live-decision">
            <p className="company-eyebrow" id="home-live-title">{demo ? "Demo preview" : "From the research floor"}</p>
            {chair ? <ReadFillPair lean={chair.lean} book={book} /> : <div className="company-live-call">Connecting</div>}
          </div>
          <div className="company-live-context"><p>{snap && chair && book ? plainLine(chair, snap, book) : "The latest Council snapshot will appear here when the research feed connects."}</p>{still ? <HomeStill last={last} /> : null}<a href="/desk" className="company-text-link">Read the full decision <span aria-hidden="true">→</span></a></div>
          {snap ? (
            <dl className="company-live-numbers"><div><dt>Bitcoin spot</dt><dd>{new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(snap.spot)}</dd></div><div><dt>Window closes in</dt><dd>{countdown}</dd></div></dl>
          ) : (
            <p className="company-muted">Waiting for the next window. The feed reconnects on its own.</p>
          )}
        </section>
        <div className="mt-4"><CanonicalRecord books={books} compact /></div>
        <p className="company-snapshot">
          {snap ? <>{demo ? "Simulated data" : "Snapshot"} · {new Date(snap.as_of).toISOString().slice(11, 19)} UTC · </> : null}
          {last && !still ? <>Last graded window · <a href={`/window/${encodeURIComponent(last.ticker)}`}>{utcStamp(last.close_time)}</a> settled {last.winner}{last.call ? ` · paper ${last.call.lean ?? "position"} at ${last.call.entry.toFixed(0)}¢, ${last.call.ev == null ? "not yet graded" : `${last.call.ev > 0 ? "+" : ""}${last.call.ev.toFixed(1)}¢ after fee`}` : " · the desk sat"} · </> : null}
          A directional read and a recorded paper fill are different.
        </p>
        <section className="company-method" aria-labelledby="method-title">
          <div className="company-section-heading"><div><p className="company-eyebrow">The process</p><h2 id="method-title">Every call has a case.<br /><em>Every result has a record.</em></h2></div><a href="/about" className="company-text-link">How it works <span aria-hidden="true">↗</span></a></div>
          <div className="company-process-grid">
            <article><span className="company-step">01 / Observe</span><h3>See the whole picture.</h3><p>Specialist seats read price structure, order flow, derivatives, market odds, and context.</p><a href="/?tab=structure">Explore the specialists <span aria-hidden="true">→</span></a></article>
            <article><span className="company-step">02 / Decide</span><h3>Know when to wait.</h3><p>The Chair brings the evidence together. A directional read must also clear the paper book’s price and safety rules.</p><a href="/desk">Follow the decision <span aria-hidden="true">→</span></a></article>
            <article><span className="company-step">03 / Review</span><h3>Let the record speak.</h3><p>Review recorded paper positions, fees, settlement results, and the experiments being tested alongside them.</p><a href="/books" onClick={() => beacon("results_open")}>Open the results <span aria-hidden="true">↗</span></a></article>
          </div>
        </section>
        <CouncilGuides />
        <section className="company-explore" aria-labelledby="explore-title">
          <div className="company-section-heading"><div><p className="company-eyebrow">Go deeper</p><h2 id="explore-title">The work behind the call.</h2></div></div>
          <div className="company-editorial-grid">
            <a href="/lab" className="company-editorial-card"><span className="company-eyebrow">Research / The Lab</span><h3>Evidence before<br />improvement.</h3><p>Follow prospective experiments and compare candidates against a frozen control.</p><span className="company-card-link">Explore the research <span aria-hidden="true">↗</span></span></a>
            <a href="/chamber" className="company-editorial-card"><span className="company-eyebrow">Council / The Chamber</span><h3>Understand<br />the conversation.</h3><p>Read the Council’s structured commentary and the evidence behind each exchange.</p><span className="company-card-link">Meet the Council <span aria-hidden="true">↗</span></span></a>
          </div>
        </section>
        <section className="company-shop" aria-labelledby="shop-title"><div><p className="company-eyebrow">The Council collection</p><h2 id="shop-title">Stillness is a decision.</h2><p>The ideas behind the floor, made to wear and keep.</p></div><a href={SHOP_URL} target="_blank" rel="noopener noreferrer" className="company-button company-button-outline" aria-label="Visit the shop (opens in a new tab)">Visit the shop <span aria-hidden="true">↗</span></a></section>
      </div>
    </main>
    <PaperDisclaimer />
  </div>;
}
