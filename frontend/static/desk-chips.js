/* Quote age + combined leftover + HL/force chips. Sits next to session + AGGR. */
(function () {
  "use strict";

  function cents(v) {
    var n = Number(v);
    if (!isFinite(n)) return null;
    if (n <= 1.5) return n * 100;
    return n;
  }

  function leftoverFrom(m) {
    if (!m) return null;
    if (m.leftover_cents != null) return Number(m.leftover_cents);
    var y = cents(m.yes_ask != null ? m.yes_ask : m.kalshi_yes_ask);
    var n = cents(m.no_ask != null ? m.no_ask : m.kalshi_no_ask);
    if (y == null || n == null) return null;
    return 100 - y - n;
  }

  function ageFrom(h, m) {
    if (h && h.quote_age_s != null) return Number(h.quote_age_s);
    if (m && m.quote_age_s != null) return Number(m.quote_age_s);
    return null;
  }

  function paint(btc, eth) {
    var ageChip = document.getElementById("quoteAgeChip");
    var leftChip = document.getElementById("leftoverChip");
    var hlChip = document.getElementById("hlChip");
    var h = (btc && btc.health) || {};
    var m = (btc && btc.market) || {};
    var feeds = (btc && btc.feeds) || {};
    var age = ageFrom(h, feeds);
    // The Chair's table book wins; the live feed only fills gaps, and when it
    // does, the chip says FEED instead of dressing feed cents as the table book.
    var fromFeed = (m.leftover_cents == null && m.yes_ask == null && m.kalshi_yes_ask == null);
    var ageFromFeed = !(h.quote_age_s != null) && (feeds.quote_age_s != null);
    var leftover = leftoverFrom(Object.assign({}, feeds, m));
    var stale = h.quote_stale === true || (age != null && age > 25);
    if (ageChip) {
      ageChip.className = "desk-chip " + (stale ? "stale" : age == null ? "off" : "live");
      var ageName = document.getElementById("quoteAgeName");
      var ageNote = document.getElementById("quoteAgeNote");
      if (ageName) ageName.textContent = (stale ? "QUOTE STALE" : "QUOTE") + (ageFromFeed && age != null ? " \u00b7 FEED" : "");
      if (ageNote) ageNote.textContent = age == null ? "\u2014" : age.toFixed(0) + "s";
    }
    if (leftChip) {
      var edge = leftover != null && leftover > 0;
      leftChip.className = "desk-chip " + (leftover == null ? "off" : edge ? "edge" : "noedge");
      var leftName = document.getElementById("leftoverName");
      var leftNote = document.getElementById("leftoverNote");
      if (leftName) leftName.textContent = (fromFeed && leftover != null) ? "LEFTOVER \u00b7 FEED" : "LEFTOVER";
      if (leftNote) {
        leftNote.textContent = leftover == null ? "\u2014" : (leftover > 0 ? "+" : "") + leftover.toFixed(1) + "\u00a2";
      }
    }
    if (hlChip) {
      var crowded = !!(h.hl_crowded || feeds.hl_crowded || (eth && eth.feeds && eth.feeds.hl_crowded));
      var forceN = Number(h.force_n || feeds.force_n || 0);
      hlChip.className = "desk-chip " + (crowded ? "crowd" : forceN ? "liq" : "off");
      var hlName = document.getElementById("hlName");
      var hlNote = document.getElementById("hlNote");
      if (hlName) hlName.textContent = crowded ? "HL CROWD" : forceN ? "FORCE LIQ" : "HL / LIQ";
      if (hlNote) hlNote.textContent = crowded ? "size cap 2.5%" : forceN ? forceN + " prints" : "quiet";
    }
    var panel = document.getElementById("deskChipPanel");
    if (!panel) return;
    function row(label, body) {
      return "<div class=\"desk-chip-row\"><b>" + label + "</b><span>" + body + "</span></div>";
    }
    var bits = [];
    bits.push(row("BTC quote", age == null ? "dark" : age.toFixed(1) + "s \u00b7 " + (h.quote_source || feeds.quote_source || "pipeline")));
    bits.push(row("Leftover", leftover == null ? "need both asks" : leftover.toFixed(2) + "\u00a2 (100 \u2212 YES \u2212 NO)" + (fromFeed ? " \u00b7 live feed" : " \u00b7 table book")));
    bits.push(row("FEED \u00b7 HL", feeds.hl_funding != null ? ("funding " + Number(feeds.hl_funding).toFixed(5) + (crowded ? " \u00b7 crowded" : "")) : "no print"));
    bits.push(row("FEED \u00b7 Force 2m", "L " + (feeds.force_long_usd || 0) + " / S " + (feeds.force_short_usd || 0)));
    panel.innerHTML = bits.join("");
  }

  async function tick() {
    var feeds = null;
    try {
      var fr = await fetch("/api/desk/feeds", { headers: { Accept: "application/json" }, credentials: "same-origin" });
      if (fr.ok) feeds = await fr.json();
    } catch (e) {}
    var state = null;
    try {
      var sr = await fetch("/api/state", { headers: { Accept: "application/json" }, credentials: "same-origin" });
      if (sr.ok) state = await sr.json();
    } catch (e) {}
    var tables = (state && state.tables) || {};
    var btc = tables.bitcoin || { health: state && state.health, market: state && state.market };
    var eth = tables.ethereum || {};
    var fromState = (state && state.feeds) || {};
    var btcFeeds = (feeds && (feeds.btc || feeds)) || fromState.btc || fromState;
    var ethFeeds = (feeds && feeds.eth) || fromState.eth || {};
    btc = Object.assign({}, btc, { feeds: btcFeeds });
    eth = Object.assign({}, eth, { feeds: ethFeeds });
    paint(btc, eth);
  }

  function bind() {
    var host = document.getElementById("deskChipBar");
    var panel = document.getElementById("deskChipPanel");
    if (!host || !panel) return;
    host.addEventListener("click", function () {
      var open = panel.hasAttribute("hidden");
      if (open) panel.removeAttribute("hidden");
      else panel.setAttribute("hidden", "");
    });
  }

  function inject() {
    if (document.getElementById("deskChipBar")) return;
    var session = document.querySelector(".session-wrap") || document.querySelector(".aggr-wrap");
    var clock = document.getElementById("liveClock");
    var host = (session && session.parentNode) || (clock && clock.parentNode) || document.querySelector("header .logo");
    if (!host) return;
    if (!document.querySelector("link[data-desk-chips]")) {
      var link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "/static/desk-chips.css?v=20260830m";
      link.setAttribute("data-desk-chips", "1");
      document.head.appendChild(link);
    }
    var wrap = document.createElement("div");
    wrap.className = "desk-chip-wrap";
    wrap.id = "deskChipBar";
    wrap.innerHTML =
      '<button type="button" id="quoteAgeChip" class="desk-chip off" title="Kalshi quote age"><span class="desk-dot"></span><span id="quoteAgeName">QUOTE</span><span id="quoteAgeNote">\u2014</span></button>' +
      '<button type="button" id="leftoverChip" class="desk-chip off" title="YES ask + NO ask leftover \u2014 table book the Chair prices; FEED = live-feed quote"><span id="leftoverName">LEFTOVER</span><span id="leftoverNote">\u2014</span></button>' +
      '<button type="button" id="hlChip" class="desk-chip off" title="Hyperliquid crowding + force liqs"><span id="hlName">HL / LIQ</span><span id="hlNote">quiet</span></button>' +
      '<div id="deskChipPanel" class="desk-chip-panel" hidden></div>';
    if (session && session.nextSibling) host.insertBefore(wrap, session.nextSibling);
    else if (session) host.appendChild(wrap);
    else if (clock && clock.nextSibling) host.insertBefore(wrap, clock.nextSibling);
    else host.appendChild(wrap);
  }

  function boot() {
    inject();
    if (!document.getElementById("deskChipBar")) {
      setTimeout(boot, 700);
      return;
    }
    bind();
    tick();
    setInterval(tick, 2000);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
