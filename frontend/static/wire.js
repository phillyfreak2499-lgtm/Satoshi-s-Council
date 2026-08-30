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
 */
(() => {
  "use strict";

  const BUILD = "2026-08-30-session-windows";
  window.COUNCIL_BUILD = BUILD;

  // Cache-bust leader stills. Portraits keep a stable URL when the signed
  // image is swapped, so the tag alone decides what a phone repaints.
  window.assetTag = function assetTag(url) {
    if (!url) return url;
    return url + (url.indexOf("?") === -1 ? "?" : "&") + "v=" + encodeURIComponent(BUILD);
  };

  // The desk polls /health while the council hydrates. "warming" is not an
  // error — it means the port is up and the first fetch has not landed yet.
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

  var s = document.createElement("script");
  s.src = "/session-window.js?v=20260830k";
  s.defer = true;
  document.head.appendChild(s);
})();
