/**
 * Satoshi’s Council — wire.js
 *
 * Boot notes and desk wiring that must load before roundtable.js paints.
 * Kept deliberately small: no rendering, no polling, no state.
 *
 * 2026-08-15-boot-listen
 *   Boot no longer blocks the port. backend/main.py binds HTTP first and
 *   hydrates the council in a background task, so a single-instance disk
 *   swap answers /health while the new container is still warming.
 *   Merges don’t 502 the desk. Why: Zach.
 *
 * 2026-08-30-session-windows
 *   Loads session-window.js so the header chip can show NY / lunch /
 *   afternoon / Asia / London windows against America/New_York.
 *
 * 2026-08-30-aggr-tape
 *   Loads the AGGR multi-exchange tape chip (aegx workspace: taker + liq).
 *
 * 2026-08-30-desk-chips
 *   Quote age, combined YES+NO leftover, Hyperliquid crowding / force liq.
 */
(() => {
  "use strict";

  const BUILD = "2026-08-30-desk-chips";
  window.COUNCIL_BUILD = BUILD;

  window.assetTag = function assetTag(url) {
    if (!url) return url;
    return url + (url.indexOf("?") === -1 ? "?" : "&") + "v=" + encodeURIComponent(BUILD);
  };

  window.councilHealth = async function councilHealth() {
    try {
      const r = await fetch("/health", { headers: { Accept: "application/json" } });
      if (!r.ok) return { status: "unreachable" };
      return await r.json();
    } catch (e) {
      return { status: "unreachable" };
    }
  };

  console.info("Satoshi’s Council · build " + BUILD + " · morning desk restored");

  function boot(src) {
    var s = document.createElement("script");
    s.src = src;
    s.defer = true;
    document.head.appendChild(s);
  }
  boot("/static/session-window.js?v=20260830k");
  boot("/static/aggr-tape.js?v=20260830a");
  boot("/static/desk-chips.js?v=20260830m");
})();
