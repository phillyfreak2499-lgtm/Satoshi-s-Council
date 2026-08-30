/* Phone dock: Floor / Tape / Paper / More. Also makes the desk installable. */
(function () {
  "use strict";

  var DOCK = [
    { id: "floor", label: "FLOOR", mode: "art" },
    { id: "tape", label: "TAPE", mode: "tape" },
    { id: "paper", label: "PAPER", mode: "paper" },
    { id: "more", label: "MORE", mode: null }
  ];

  var MORE = [
    ["seats", "SEATS"],
    ["room", "ROOM"],
    ["book", "BOOK"],
    ["calls", "CALLS"],
    ["charts", "CHARTS"],
    ["school", "SCHOOL"],
    ["news", "NEWS"],
    ["wire", "WIRE"],
    ["settings", "SETTINGS"],
    ["floor", "CINEMA FLOOR"],
    ["stream", "STREAM"]
  ];

  function phone() {
    return document.documentElement.classList.contains("phone-desk");
  }

  function ensureHead() {
    if (!document.querySelector('link[rel="manifest"]')) {
      var m = document.createElement("link");
      m.rel = "manifest";
      m.href = "/static/manifest.webmanifest";
      document.head.appendChild(m);
    }
    function meta(name, content) {
      if (document.querySelector('meta[name="' + name + '"]')) return;
      var el = document.createElement("meta");
      el.name = name;
      el.content = content;
      document.head.appendChild(el);
    }
    meta("theme-color", "#07070c");
    meta("apple-mobile-web-app-capable", "yes");
    meta("mobile-web-app-capable", "yes");
    meta("apple-mobile-web-app-status-bar-style", "black-translucent");
    meta("apple-mobile-web-app-title", "Council");
    if (!document.querySelector('link[rel="apple-touch-icon"]')) {
      var ic = document.createElement("link");
      ic.rel = "apple-touch-icon";
      ic.href = "/council-mark.png";
      document.head.appendChild(ic);
    }
    if (!document.getElementById("phoneNavCss")) {
      var l = document.createElement("link");
      l.id = "phoneNavCss";
      l.rel = "stylesheet";
      l.href = "/static/phone-nav.css?v=20260830r";
      document.head.appendChild(l);
    }
  }

  function setMode(mode) {
    var btn = document.querySelector('.mode-tab[data-mode="' + mode + '"]');
    if (btn) {
      btn.click();
      return;
    }
    if (typeof window.setMode === "function") {
      try { window.setMode(mode); } catch (e) {}
    }
  }

  function currentMode() {
    var active = document.querySelector("#modeTabs .mode-tab.active[data-mode]");
    if (active) return active.getAttribute("data-mode");
    var body = document.body;
    if (!body || !body.className) return "art";
    var m = body.className.match(/mode-([a-z0-9]+)/);
    return m ? m[1] : "art";
  }

  function paintDock() {
    var mode = currentMode();
    var floorish = mode === "art" || mode === "floor" || !mode;
    document.querySelectorAll("#phoneDock [data-dock]").forEach(function (b) {
      var id = b.getAttribute("data-dock");
      var on = (id === "floor" && floorish) || (id === mode);
      b.setAttribute("aria-current", on ? "page" : "false");
    });
  }

  function closeMore() {
    var sheet = document.getElementById("phoneMoreSheet");
    if (sheet) sheet.classList.remove("open");
  }

  function toggleMore() {
    var sheet = document.getElementById("phoneMoreSheet");
    if (!sheet) return;
    sheet.classList.toggle("open");
  }

  function inject() {
    if (document.getElementById("phoneDock")) return;
    var dock = document.createElement("nav");
    dock.id = "phoneDock";
    dock.setAttribute("aria-label", "Phone desk");
    dock.innerHTML = DOCK.map(function (d) {
      return '<button type="button" data-dock="' + d.id + '" data-mode="' + (d.mode || "") + '">' +
        '<span class="dock-ico" aria-hidden="true"></span>' +
        d.label +
        "</button>";
    }).join("");
    document.body.appendChild(dock);

    var sheet = document.createElement("aside");
    sheet.id = "phoneMoreSheet";
    sheet.innerHTML =
      "<h3>MORE</h3><div class=\"more-grid\">" +
      MORE.map(function (pair) {
        return '<button type="button" data-more-mode="' + pair[0] + '">' + pair[1] + "</button>";
      }).join("") +
      "</div>" +
      '<div id="phoneInstallHint"><b>ADD TO HOME SCREEN</b>' +
      "Android: Chrome menu → Add to Home screen / Install app.<br>" +
      "iPhone: Share → Add to Home Screen.<br>" +
      "Opens full-screen like an app. Same desk, no extra store listing.</div>";
    document.body.appendChild(sheet);

    dock.addEventListener("click", function (e) {
      var b = e.target.closest("[data-dock]");
      if (!b) return;
      var id = b.getAttribute("data-dock");
      if (id === "more") {
        toggleMore();
        return;
      }
      closeMore();
      setMode(b.getAttribute("data-mode") || "art");
      paintDock();
    });
    sheet.addEventListener("click", function (e) {
      var b = e.target.closest("[data-more-mode]");
      if (!b) return;
      closeMore();
      setMode(b.getAttribute("data-more-mode"));
      paintDock();
    });
  }

  function normalizeHash() {
    if (!phone()) return;
    if (location.hash === "#art") {
      document.body.classList.add("mode-art");
    }
  }

  function boot() {
    ensureHead();
    if (!phone()) return;
    inject();
    normalizeHash();
    paintDock();
    var tabs = document.getElementById("modeTabs");
    if (tabs && !tabs.__phoneDockObs) {
      tabs.__phoneDockObs = true;
      tabs.addEventListener("click", function () {
        setTimeout(paintDock, 50);
      });
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
  window.addEventListener("hashchange", function () {
    normalizeHash();
    paintDock();
  });
  window.addEventListener("resize", function () {
    if (phone()) boot();
  });
})();
