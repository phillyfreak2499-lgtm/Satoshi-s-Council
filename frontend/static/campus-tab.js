/* Satoshi’s Council — Classroom + Dojo campus tabs.
   Drop AFTER roundtable.js. */
(function () {
  window.CAMPUS_URL = window.CAMPUS_URL || "/campus";
  window.CAMPUS_DOJO_HIJACK = true;
  var CAMPUS = String(window.CAMPUS_URL || "").replace(/\/$/, "");
  if (!CAMPUS) return;

  function loadScreens() {
    if (document.getElementById("screensJs")) return;
    var s = document.createElement("script");
    s.id = "screensJs";
    s.src = "/screens.js?v=20260820s";
    document.head.appendChild(s);
  }

  function ensureView() {
    var view = document.getElementById("classroomView");
    if (view) return view;
    view = document.createElement("section");
    view.id = "classroomView";
    view.className = "info-view hidden";
    view.setAttribute("aria-label", "The Classroom");
    var frame = document.createElement("iframe");
    frame.id = "classroomFrame";
    frame.title = "Satoshi’s Classroom";
    frame.setAttribute("allow", "fullscreen");
    view.appendChild(frame);
    var school = document.getElementById("schoolView");
    if (school && school.parentNode) school.parentNode.insertBefore(view, school.nextSibling);
    else (document.getElementById("app") || document.body).appendChild(view);
    return view;
  }

  function ensureTab() {
    var tabs = document.getElementById("modeTabs");
    if (!tabs) return;
    var school = document.getElementById("tabSchool");
    if (school) {
      school.id = "tabDojo";
      school.setAttribute("data-mode", "school");
      school.textContent = "Dojo";
      school.title = "Candle Dojo — the mat. Body, wick, close.";
    }
    if (!document.getElementById("tabClassroom")) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.id = "tabClassroom";
      btn.className = "mode-tab";
      btn.setAttribute("data-mode", "classroom");
      btn.title = "The Classroom — Bitcoin and Kalshi school.";
      btn.textContent = "Classroom";
      var dojo = document.getElementById("tabDojo");
      if (dojo && dojo.parentNode) dojo.parentNode.insertBefore(btn, dojo);
      else tabs.appendChild(btn);
    }
  }

  function showCampus(path) {
    var view = ensureView();
    var frame = document.getElementById("classroomFrame");
    var url = CAMPUS + (path || "/");
    if (frame && frame.getAttribute("src") !== url) frame.src = url;
    view.classList.remove("hidden");
    document.body.classList.add("mode-classroom");
    document.body.classList.remove("mode-school", "mode-screen1", "mode-screen2");
    document.querySelectorAll(".mode-tab").forEach(function (el) {
      var on = (path === "/dojo" && el.id === "tabDojo") || (path !== "/dojo" && el.id === "tabClassroom");
      el.classList.toggle("active", on);
      if (el.hasAttribute("aria-selected")) el.setAttribute("aria-selected", on ? "true" : "false");
    });
    var school = document.getElementById("schoolView");
    if (school) school.classList.add("hidden");
    var main = document.getElementById("mainTable");
    if (main) main.classList.add("hidden");
    ["seatsView","paperView","settingsView","tapeView","bookView","brainView","newsView","wireView","callsView","chartsView","streamChrome","screenOne","screenTwo"].forEach(function (id) {
      var n = document.getElementById(id);
      if (n) n.classList.add("hidden");
    });
  }

  function hideCampus() {
    document.body.classList.remove("mode-classroom");
    var view = document.getElementById("classroomView");
    if (view) view.classList.add("hidden");
  }

  function boot() {
    ensureTab();
    ensureView();
    loadScreens();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  document.addEventListener(
    "click",
    function (e) {
      var t = e.target && e.target.closest && e.target.closest(".mode-tab");
      if (!t) return;
      if (t.id === "tabClassroom" || t.getAttribute("data-mode") === "classroom") {
        e.preventDefault();
        e.stopPropagation();
        showCampus("/");
        return;
      }
      if (t.id === "tabDojo" || t.id === "tabSchool") {
        e.preventDefault();
        e.stopPropagation();
        var path = window.__dojoKata ? "/dojo#kata" : "/dojo";
        window.__dojoKata = false;
        showCampus(path);
        return;
      }
      hideCampus();
    },
    true
  );
})();
