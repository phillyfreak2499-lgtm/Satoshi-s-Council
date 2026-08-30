/* Focus chips: BTC ETH DWF ATS ORA.
   seat.js already calls window.setFocusTable(data-focus). This file defines it. */
(function (w) {
  var KEY = "council_focus_table";
  var META = {
    bitcoin:  { badge: "BTC · SATOSHI", streamSafe: true },
    ethereum: { badge: "ETH · VITALIK", streamSafe: true },
    front:    { badge: "DWF · RAIJIN",  streamSafe: false },
    ats:      { badge: "ATS · ARES",    streamSafe: false },
    oracle:   { badge: "ORA · ORACLE",  streamSafe: false }
  };
  var ALIAS = {
    btc: "bitcoin", eth: "ethereum", dwf: "front", raijin: "front",
    ares: "ats", ora: "oracle", weather: "front", sports: "ats"
  };

  function norm(name) {
    name = String(name || "").toLowerCase().trim();
    if (ALIAS[name]) name = ALIAS[name];
    return META[name] ? name : "bitcoin";
  }

  function isStream() {
    var b = document.body;
    if (!b) return false;
    return b.classList.contains("mode-stream") || b.getAttribute("data-mode") === "stream";
  }

  function show(id, on) {
    var el = typeof id === "string" ? document.getElementById(id) : id;
    if (!el) return;
    if (on) {
      el.hidden = false;
      el.removeAttribute("hidden");
      el.classList.remove("hidden");
      el.setAttribute("aria-hidden", "false");
    } else {
      el.hidden = true;
      el.setAttribute("hidden", "");
      el.classList.add("hidden");
      el.setAttribute("aria-hidden", "true");
    }
  }

  function persist(name) {
    try { if (w.CouncilSeat && CouncilSeat.set) CouncilSeat.set(KEY, name); } catch (e) {}
    try { localStorage.setItem(KEY, name); } catch (e2) {}
  }

  function readSaved() {
    try {
      if (w.CouncilSeat && CouncilSeat.get) {
        var v = CouncilSeat.get(KEY);
        if (v) return v;
      }
    } catch (e) {}
    try { return localStorage.getItem(KEY); } catch (e2) {}
    return null;
  }

  function injectCss() {
    if (document.getElementById("focusTableCss")) return;
    var s = document.createElement("style");
    s.id = "focusTableCss";
    s.textContent = [
      ".focus-tab{cursor:pointer;pointer-events:auto;position:relative;z-index:40}",
      ".focus-tab.on{color:#fff;background:rgba(0,232,255,.16);box-shadow:inset 0 -2px 0 #00e8ff}",
      "#focusTableBadge{pointer-events:none}",
      "#passwordGate.hidden,#summonGate.hidden,",
      ".summon-video-wrap:not(.active),#deskIntroWrap.hidden,",
      "#celebrateVideoWrap.hidden,#leaderClickWrap.hidden,",
      "#coachOverlay.hidden{pointer-events:none!important}",
      "body[data-focus=ats] #atsChartTape{display:block}"
    ].join("");
    (document.head || document.documentElement).appendChild(s);
  }

  function paintFaces(visual) {
    var crypto = visual === "bitcoin" || visual === "ethereum";
    show("chairWhy", crypto);
    show("atsWhy", visual === "ats");
    show("atsWatch", visual === "ats");
    show("oraWhy", visual === "oracle");
    show("oraWatch", visual === "oracle");
    show("aresFace", visual === "ats");
    show("raijinFace", visual === "front");
    show("atsChartTape", visual === "ats");
    document.querySelectorAll("[data-floor-clock]").forEach(function (n) {
      n.classList.toggle("on", n.getAttribute("data-floor-clock") === visual);
    });
    document.querySelectorAll(".chart-pair-btc").forEach(function (n) {
      n.classList.toggle("is-focus", visual === "bitcoin");
    });
    document.querySelectorAll(".chart-pair-eth").forEach(function (n) {
      n.classList.toggle("is-focus", visual === "ethereum");
    });
  }

  function setFocusTable(name, opts) {
    opts = opts || {};
    name = norm(name);
    injectCss();

    var stream = isStream();
    if (stream && !META[name].streamSafe && typeof w.setMode === "function") {
      try { w.setMode("art"); } catch (e) {}
      stream = isStream();
    }

    var visual = name;
    if (stream && !META[name].streamSafe) visual = "bitcoin";

    document.documentElement.setAttribute("data-focus", name);
    if (document.body) document.body.setAttribute("data-focus", name);

    document.querySelectorAll(".focus-tab").forEach(function (btn) {
      var on = btn.getAttribute("data-focus") === name;
      btn.classList.toggle("on", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });

    var badge = document.getElementById("focusTableBadge");
    if (badge) badge.textContent = META[name].badge;

    paintFaces(visual);

    if (!opts.skipPersist) persist(name);

    w.__focusTable = name;
    try {
      if (typeof w.onFocusTable === "function") w.onFocusTable(name);
    } catch (e) {}
    return name;
  }

  function boot() {
    injectCss();
    var saved = readSaved();
    setFocusTable(saved || "bitcoin", { skipPersist: true });
  }

  w.setFocusTable = setFocusTable;
  w.wireFocusAndHelp = function wireFocusAndHelp() { boot(); };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})(window);
