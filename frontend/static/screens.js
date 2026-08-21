/* Screen 1 (orbit mesh) + Screen 2 (TV charts). Bitcoin only. */
(function () {
  var SEATS = [
    { id: "wick", name: "WICK", img: "/portraits/wick.webp?v=people-2" },
    { id: "clock", name: "CLOCK", img: "/portraits/clock.webp?v=people-2" },
    { id: "tape", name: "TAPE", img: "/portraits/tape.webp?v=people-2" },
    { id: "crowd", name: "CROWD", img: "/portraits/crowd.webp?v=people-2" },
    { id: "flow", name: "FLOW", img: "/portraits/flow.webp?v=people-2" }
  ];
  var RAIL = ["WATCH", "WIND-UP", "GAVEL", "POLAROID", "SIT"];

  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html) n.innerHTML = html;
    return n;
  }

  function ensureCss() {
    if (document.getElementById("screensCss")) return;
    var l = document.createElement("link");
    l.id = "screensCss";
    l.rel = "stylesheet";
    l.href = "/screens.css?v=20260820s";
    document.head.appendChild(l);
  }

  function ensureViews() {
    if (document.getElementById("screenOne")) return;
    var one = el("section", "screen-view");
    one.id = "screenOne";
    one.setAttribute("aria-label", "Screen 1");
    var rail = el("div", "s-rail");
    rail.id = "s1Rail";
    RAIL.forEach(function (w) {
      var s = el("span");
      s.textContent = w;
      s.dataset.step = w;
      rail.appendChild(s);
    });
    var stage = el("div", "s1-stage");
    var chair = el("div");
    chair.id = "s1Chair";
    chair.innerHTML = '<img src="/portraits/satoshi-up.webp?v=people-2" alt="Satoshi">';
    var orbit = el("div");
    orbit.id = "s1Orbit";
    SEATS.forEach(function (s, i) {
      var ang = (i / SEATS.length) * Math.PI * 2 - Math.PI / 2;
      var node = el("div", "s1-seat");
      node.id = "s1-" + s.id;
      node.style.transform = "rotate(" + (ang * 180 / Math.PI) + "deg) translate(min(34vw, 210px)) rotate(" + (-ang * 180 / Math.PI) + "deg)";
      node.innerHTML = "<img src=\"" + s.img + "\" alt=\"\"><b>" + s.name + "</b>";
      orbit.appendChild(node);
    });
    stage.appendChild(orbit);
    stage.appendChild(chair);
    var foot = el("div", "s1-foot");
    foot.id = "s1Line";
    foot.innerHTML = "The Chair is sitting.<small>SCREEN 1 · BITCOIN</small>";
    one.appendChild(rail);
    one.appendChild(stage);
    one.appendChild(foot);

    var two = el("section", "screen-view");
    two.id = "screenTwo";
    two.setAttribute("aria-label", "Screen 2");
    var rail2 = el("div", "s-rail");
    rail2.id = "s2Rail";
    RAIL.forEach(function (w) {
      var s = el("span");
      s.textContent = w;
      s.dataset.step = w;
      rail2.appendChild(s);
    });
    var grid = el("div", "s2-grid");
    grid.innerHTML =
      '<article class="s2-card"><h3>SEAT PULSE</h3><div class="s2-bars" id="s2Bars"></div></article>' +
      '<article class="s2-card"><h3>WINDOW</h3><div class="s2-clock" id="s2Clock">--:--</div><p id="s2Sit">The Chair is sitting.</p></article>' +
      '<article class="s2-card s2-wide"><h3>15M TAPE</h3><canvas id="s2Tape" width="640" height="72"></canvas></article>' +
      '<article class="s2-card s2-wide"><h3>WORD</h3><p class="s2-line" id="s2Word">Wick — price went there and got shoved back.</p></article>';
    two.appendChild(rail2);
    two.appendChild(grid);

    var app = document.getElementById("app") || document.body;
    app.appendChild(one);
    app.appendChild(two);

    var bars = document.getElementById("s2Bars");
    SEATS.forEach(function (s) {
      var i = el("i");
      i.style.height = "18%";
      i.id = "s2b-" + s.id;
      i.innerHTML = "<em>" + s.name + "</em>";
      bars.appendChild(i);
    });
  }

  function ensureTabs() {
    var tabs = document.getElementById("modeTabs");
    if (!tabs) return;
    if (document.getElementById("tabScreen1")) return;
    function tab(id, mode, label) {
      var b = document.createElement("button");
      b.type = "button";
      b.id = id;
      b.className = "mode-tab";
      b.setAttribute("data-mode", mode);
      b.textContent = label;
      return b;
    }
    var night = document.getElementById("tabNight");
    var a = tab("tabScreen1", "screen1", "Screen 1");
    var b = tab("tabScreen2", "screen2", "Screen 2");
    if (night && night.parentNode) {
      night.parentNode.insertBefore(a, night);
      night.parentNode.insertBefore(b, night);
    } else {
      tabs.appendChild(a);
      tabs.appendChild(b);
    }
  }

  function setRail(id, step) {
    var rail = document.getElementById(id);
    if (!rail) return;
    rail.querySelectorAll("span").forEach(function (s) {
      s.classList.toggle("on", s.dataset.step === step);
    });
  }

  function hideScreens() {
    document.body.classList.remove("mode-screen1", "mode-screen2");
  }

  function show(which) {
    ensureViews();
    document.body.classList.remove("mode-screen1", "mode-screen2", "mode-classroom");
    document.body.classList.add(which === 2 ? "mode-screen2" : "mode-screen1");
    ["mainTable", "classroomView", "schoolView", "seatsView", "paperView",
     "settingsView", "tapeView", "bookView", "brainView", "newsView", "wireView",
     "callsView", "chartsView", "streamChrome"].forEach(function (id) {
      var n = document.getElementById(id);
      if (n) n.classList.add("hidden");
    });
    document.querySelectorAll(".mode-tab").forEach(function (el) {
      var on = (which === 1 && el.id === "tabScreen1") || (which === 2 && el.id === "tabScreen2");
      el.classList.toggle("active", on);
    });
    tick();
  }

  function tick() {
    var step = "WATCH";
    var line = "Waiting on the Chair.";
    var leans = {};
    try {
      var st = window.__lastState || window.LAST_STATE || {};
      var btc = (st.tables && st.tables.bitcoin) || st.btc || st;
      var dec = (btc && btc.decision) || {};
      var dir = String((dec.locked_call && dec.locked_call.direction) || dec.direction || "WAIT").toUpperCase();
      var locked = !!(dec.locked_call && dec.locked_call.locked);
      if (dir === "WAIT" && !locked) { step = "SIT"; line = "The Chair is sitting."; }
      else if (locked) { step = "POLAROID"; line = dir + " locked. Polaroid holds."; }
      else { step = "WIND-UP"; line = "Seats leaning. Chair sitting."; }
      var bots = btc.bots || btc.seats || [];
      (bots || []).forEach(function (b) {
        var name = String(b.name || b.id || "").toLowerCase();
        SEATS.forEach(function (s) {
          if (name.indexOf(s.id) !== -1) leans[s.id] = b.direction || b.side || "WAIT";
        });
      });
      var t = (btc.market && btc.market.seconds_left) || btc.seconds_left;
      if (t != null) {
        var m = Math.max(0, Math.floor(Number(t) / 60));
        var sec = Math.max(0, Math.floor(Number(t) % 60));
        var clock = document.getElementById("s2Clock");
        if (clock) clock.textContent = String(m).padStart(2, "0") + ":" + String(sec).padStart(2, "0");
      }
    } catch (e) {}
    setRail("s1Rail", step);
    setRail("s2Rail", step);
    var fl = document.getElementById("s1Line");
    if (fl) fl.childNodes[0].textContent = line;
    var sit = document.getElementById("s2Sit");
    if (sit) sit.textContent = line;
    SEATS.forEach(function (s) {
      var node = document.getElementById("s1-" + s.id);
      if (node) node.classList.toggle("lean", /UP|DOWN/i.test(leans[s.id] || ""));
      var bar = document.getElementById("s2b-" + s.id);
      if (bar) bar.style.height = /UP|DOWN/i.test(leans[s.id] || "") ? "78%" : "22%";
    });
  }

  function boot() {
    ensureCss();
    ensureTabs();
    ensureViews();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  document.addEventListener("click", function (e) {
    var t = e.target && e.target.closest && e.target.closest(".mode-tab");
    if (!t) return;
    if (t.id === "tabScreen1") { e.preventDefault(); e.stopPropagation(); show(1); return; }
    if (t.id === "tabScreen2") { e.preventDefault(); e.stopPropagation(); show(2); return; }
    hideScreens();
  }, true);

  setInterval(function () {
    if (document.body.classList.contains("mode-screen1") || document.body.classList.contains("mode-screen2")) tick();
  }, 4000);
})();
