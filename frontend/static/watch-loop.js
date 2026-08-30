/* Watch-loop: Stream/Table phases only. No trading. No Follower. No new APIs. */
(function (w) {
  var PHASES = ["wl-entry", "wl-mid", "wl-last90", "wl-close", "wl-still"];
  var DISTURB = { charts: 1, tape: 1, book: 1, school: 1, side: 1 };
  var landed = false;

  function injectCss() {
    if (document.getElementById("watchLoopCss")) return;
    var l = document.createElement("link");
    l.id = "watchLoopCss";
    l.rel = "stylesheet";
    l.href = "/watch-loop.css?v=20260830w";
    document.head.appendChild(l);
  }

  function mode() {
    var b = document.body;
    if (!b) return "";
    if (b.classList.contains("mode-stream")) return "stream";
    if (b.classList.contains("mode-art")) return "art";
    if (b.classList.contains("mode-floor")) return "floor";
    if (b.classList.contains("mode-school")) return "school";
    return b.getAttribute("data-mode") || "";
  }

  function parseLeft() {
    var el = document.getElementById("windowTimer") || document.getElementById("ledWindowTime");
    if (!el) return null;
    var t = String(el.textContent || "").trim();
    var m = t.match(/(\d+):(\d+)/);
    if (!m) return null;
    return Number(m[1]) * 60 + Number(m[2]);
  }

  function setPhase(name) {
    var b = document.body;
    if (!b) return;
    PHASES.forEach(function (p) { b.classList.toggle(p, p === name); });
    b.setAttribute("data-wl-phase", name.replace("wl-", ""));
  }

  function tickPhase() {
    var m = mode();
    if (m !== "stream" && m !== "art") return;
    var left = parseLeft();
    if (left == null) { setPhase("wl-entry"); return; }
    if (left <= 0) {
      setPhase(document.getElementById("closeRecap") &&
        !document.getElementById("closeRecap").classList.contains("hidden")
        ? "wl-close" : "wl-still");
      hushAfterWhistle();
      return;
    }
    if (left <= 90) setPhase("wl-last90");
    else if (left <= 8 * 60) setPhase("wl-mid");
    else setPhase("wl-entry");
  }

  function hushAfterWhistle() {
    ["hourSlam", "floorCrawl", "lightsaberWrap", "seatStormPrompt", "seatStormPlay"].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.classList.add("hidden");
      el.hidden = true;
    });
    var recap = document.getElementById("closeRecap");
    if (recap && !recap.querySelector("#wlNextWindow")) {
      var n = document.createElement("p");
      n.id = "wlNextWindow";
      n.className = "close-books";
      n.textContent = "Next whistle on the clock. School if the tape is dead.";
      var card = recap.querySelector(".close-recap-card");
      if (card) card.appendChild(n);
    }
  }

  function landStreamOnce() {
    if (landed) return;
    if (!document.body || !document.body.classList.contains("desk-unlocked")) return;
    var last = "";
    try {
      last = (w.CouncilSeat && CouncilSeat.get && CouncilSeat.get("council_last_mode")) || localStorage.getItem("council_last_mode") || "";
    } catch (e) {}
    if (last && last !== "stream" && last !== "art") return;
    landed = true;
    if (mode() !== "stream" && typeof w.setMode === "function") {
      try { w.setMode("stream"); } catch (e) {}
    }
  }

  function blockDisturbance(e) {
    var t = e.target && e.target.closest && e.target.closest("[data-mode], #openChartsBtn, #seatStormPrompt, #seatStormTableBtn");
    if (!t) return;
    var m = t.getAttribute("data-mode") || (t.id === "openChartsBtn" ? "charts" : (t.id && t.id.indexOf("seatStorm") === 0 ? "side" : ""));
    if (!DISTURB[m]) return;
    var phase = document.body && document.body.getAttribute("data-wl-phase");
    var onPitch = mode() === "stream" || mode() === "art";
    if (onPitch && (phase === "last90" || phase === "mid" || phase === "entry")) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  function boot() {
    injectCss();
    landStreamOnce();
    tickPhase();
    document.addEventListener("click", blockDisturbance, true);
    setInterval(function () { landStreamOnce(); tickPhase(); }, 1000);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})(window);
