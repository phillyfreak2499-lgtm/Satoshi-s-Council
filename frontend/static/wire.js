/**
 * Satoshi’s Council — wire.js
 *
 * Boot notes and desk wiring that must load before roundtable.js paints.
 *
 * 2026-08-20-shrine-floor
 *   Remap Wick/Strike/Odds/Quorum/Clock/Satoshi to shrine portraits.
 *   Hide hit-rate HUD on Floor/Table. Accuracy stays in Settings.
 */
(() => {
  "use strict";

  const BUILD = "2026-08-20-shrine-floor";
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

  const FACE = {
    wick: "/portraits/wick.jpg",
    strike: "/portraits/strike.jpg",
    odds: "/portraits/odds.jpg",
    quorum: "/portraits/quorum.jpg",
    clock: "/portraits/clock.jpg",
    satoshi: "/portraits/satoshi-up.jpg"
  };

  function remap(url) {
    var s = String(url || "");
    if (!s || s.indexOf("/portraits/") !== -1) return s;
    var lower = s.toLowerCase();
    if (/chair-up|chair-wait|chair-down|chair-sell|satoshi-shrine/.test(lower)) {
      return FACE.satoshi;
    }
    var names = ["wick", "strike", "odds", "quorum", "clock"];
    for (var i = 0; i < names.length; i++) {
      var n = names[i];
      if (new RegExp("(?:^|[/_.-])" + n + "(?:[-_.]|\\.|$)", "i").test(lower) &&
          /bots|static|chair|portrait/.test(lower)) {
        return FACE[n];
      }
    }
    return s;
  }

  var proto = HTMLImageElement.prototype;
  var desc = Object.getOwnPropertyDescriptor(proto, "src");
  if (desc && desc.set && desc.get) {
    Object.defineProperty(proto, "src", {
      configurable: true,
      enumerable: desc.enumerable,
      get: function () { return desc.get.call(this); },
      set: function (v) { desc.set.call(this, remap(v)); }
    });
  }
  var origSet = proto.setAttribute;
  proto.setAttribute = function (name, value) {
    if (String(name).toLowerCase() === "src") value = remap(value);
    return origSet.call(this, name, value);
  };

  var link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "/floor-art.css?v=" + encodeURIComponent(BUILD);
  document.head.appendChild(link);

  console.info("Satoshi’s Council · build " + BUILD);
})();
