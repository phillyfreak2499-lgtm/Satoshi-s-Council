/* Phone desk first — hide empty lifetime rail on coarse/narrow/portrait. */
(function () {
  function phoneDeskOn() {
    var w = window.innerWidth || 0;
    var h = window.innerHeight || 0;
    var coarse = false;
    try { coarse = window.matchMedia("(hover: none) and (pointer: coarse)").matches; } catch (e) {}
    return coarse || w <= 1100 || (h >= w && w <= 1400);
  }
  function applyPhoneDesk() {
    var on = phoneDeskOn();
    document.documentElement.classList.toggle("phone-desk", on);
    if (document.body) document.body.classList.toggle("phone-desk", on);
  }
  if (!document.getElementById("phoneDeskInline")) {
    var s = document.createElement("style");
    s.id = "phoneDeskInline";
    s.textContent = "html.phone-desk #lifetimePanel{display:none!important;width:0!important;max-width:0!important;overflow:hidden!important;border:0!important;padding:0!important;margin:0!important}html.phone-desk #mainTable,html.phone-desk body #mainTable,html.phone-desk body.mode-art #mainTable{display:flex!important;flex-direction:column!important;grid-template-columns:none!important;grid-template-areas:none!important;grid-template-rows:none!important;height:auto!important;max-height:none!important;overflow:visible!important;padding:0!important;gap:0!important;column-gap:0!important}html.phone-desk #tableStage,html.phone-desk #mainTable #tableStage{order:1!important;width:100%!important;min-width:0!important;min-height:min(62dvh,560px)!important;height:min(62dvh,560px)!important;flex:0 0 auto!important;display:flex!important;grid-area:auto!important}html.phone-desk #roundtable{width:100%!important;height:100%!important;max-width:none!important}html.phone-desk #debatePanel,html.phone-desk body.mode-art #debatePanel{display:flex!important;order:2!important;position:relative!important;width:100%!important;max-width:none!important;min-height:180px!important;max-height:42dvh!important;flex:1 1 auto!important;border-left:none!important;border-top:1px solid rgba(0,232,255,.18)!important;grid-area:auto!important}html.phone-desk #hierarchyPanel{display:none!important}";
    (document.head || document.documentElement).appendChild(s);
  }
  applyPhoneDesk();
  window.addEventListener("resize", applyPhoneDesk);
  window.addEventListener("orientationchange", applyPhoneDesk);
  document.addEventListener("DOMContentLoaded", applyPhoneDesk);
})();

(function (w) {
  var DB_NAME = "council_seat";
  var DB_VER = 1;
  var STORE = "kv";
  var ID_KEY = "council_seat_id";
  var cache = Object.create(null);
  var db = null;
  var readyResolve;
  var ready = new Promise(function (res) { readyResolve = res; });

  function seatId() {
    try {
      var id = localStorage.getItem(ID_KEY);
      if (!id) {
        id = (w.crypto && crypto.randomUUID) ? crypto.randomUUID() : ("s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
        localStorage.setItem(ID_KEY, id);
      }
      return id;
    } catch (e) {
      return "anon";
    }
  }

  function lsKey(name) { return "seat:" + seatId() + ":" + name; }

  function seedFromLocal(name) {
    try {
      var v = localStorage.getItem(lsKey(name));
      if (v != null) return v;
      var old = localStorage.getItem(name);
      if (old != null) return old;
    } catch (e) {}
    return null;
  }

  function mirrorLock(name, val) {
    if (name !== "council_seat_locked" && name !== "council_onboarded" && name !== "council_entered") return;
    try { localStorage.setItem(lsKey(name), val); } catch (e) {}
    if (name === "council_seat_locked") {
      try { localStorage.setItem("council_seat_locked", val); } catch (e) {}
    }
  }

  function get(name) {
    if (Object.prototype.hasOwnProperty.call(cache, name)) return cache[name];
    var v = seedFromLocal(name);
    if (v != null) cache[name] = v;
    return v;
  }

  function putIdb(name, val) {
    if (!db) return;
    try {
      var tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put({ k: name, v: val, at: Date.now() });
    } catch (e) {}
  }

  function set(name, val) {
    val = String(val);
    cache[name] = val;
    mirrorLock(name, val);
    putIdb(name, val);
  }

  function getJson(name, fallback) {
    try {
      var r = get(name);
      if (r == null || r === "") return fallback;
      return JSON.parse(r);
    } catch (e) { return fallback; }
  }

  function setJson(name, obj) {
    set(name, JSON.stringify(obj));
  }

  function isLocked() {
    try {
      if (localStorage.getItem("council_seat_locked") === "1") return true;
    } catch (e) {}
    return get("council_seat_locked") === "1";
  }

  var VIEW_IDS = {
    settings: "settingsView",
    seats: "seatsView",
    paper: "paperView",
    calls: "callsView",
    tape: "tapeView",
    book: "bookView",
    brain: "brainView",
    news: "newsView",
    wire: "wireView",
    school: "schoolView",
    charts: "chartsView",
    side: "sideView",
    front: "frontView",
    room: "roomView"
  };

  function fallbackSetMode(mode) {
    if (!mode) return;
    var body = document.body;
    if (!body) return;
    body.className = String(body.className || "").replace(/\bmode-[a-z0-9_-]+/g, "").trim();
    body.classList.add("mode-" + mode);
    document.querySelectorAll(".info-view").forEach(function (v) {
      v.classList.add("hidden");
      v.setAttribute("hidden", "");
    });
    var id = VIEW_IDS[mode];
    if (id) {
      var panel = document.getElementById(id);
      if (panel) {
        panel.classList.remove("hidden");
        panel.removeAttribute("hidden");
      }
    }
    document.querySelectorAll(".mode-tab[data-mode]").forEach(function (b) {
      var on = b.getAttribute("data-mode") === mode;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    var moreBtn = document.getElementById("moreBtn");
    if (moreBtn) {
      var overflow = "floor night tape book brain news wire school charts";
      moreBtn.classList.toggle("active", overflow.indexOf(mode) >= 0);
    }
  }
  w.__deskSetModeFallback = fallbackSetMode;
  if (typeof w.setMode !== "function") w.setMode = fallbackSetMode;

  function paintUnlocked() {
    w.__deskUnlockedThisPage = true;
    try { sessionStorage.setItem("council_auth_ok", "1"); } catch (e) {}
    try { localStorage.setItem("council_auth_ok", "1"); } catch (e) {}
    var html = document.documentElement;
    var body = document.body;
    if (html) {
      html.classList.remove("gate-locked", "gate-revealing");
      html.classList.add("desk-unlocked");
    }
    if (body) {
      body.classList.remove("gate-locked", "gate-revealing");
      body.classList.add("desk-unlocked");
    }
    ["passwordGate", "summonGate"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) {
        el.classList.add("hidden");
        el.style.pointerEvents = "none";
      }
    });
    ["summonVideoWrap", "deskIntroWrap", "celebrateVideoWrap", "leaderClickWrap"].forEach(function (id) {
      var wrap = document.getElementById(id);
      if (wrap) {
        wrap.classList.remove("active");
        wrap.classList.add("hidden");
        wrap.style.pointerEvents = "none";
      }
    });
    try {
      if (typeof w.revealAppAfterDeskUnlock === "function") w.revealAppAfterDeskUnlock();
    } catch (e) {}
  }

  function lockSeat() {
    set("council_seat_locked", "1");
    set("council_onboarded", "1");
    set("council_entered", "1");
    paintUnlocked();
  }

  function openDb() {
    if (!w.indexedDB) {
      readyResolve(false);
      return;
    }
    var req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = function (ev) {
      var d = ev.target.result;
      if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: "k" });
    };
    req.onerror = function () { readyResolve(false); };
    req.onsuccess = function () {
      db = req.result;
      var tx = db.transaction(STORE, "readonly");
      var r = tx.objectStore(STORE).getAll();
      r.onsuccess = function () {
        (r.result || []).forEach(function (row) {
          if (row && row.k != null && row.v != null) cache[row.k] = String(row.v);
        });
        migrateLegacy();
        readyResolve(true);
      };
      r.onerror = function () {
        migrateLegacy();
        readyResolve(false);
      };
    };
  }

  var LEGACY = [
    "council_onboarded", "council_entered", "council_joined", "council_monday_paper",
    "council_day_recap", "council_call_sfx", "council_team_loops", "council_beast",
    "council_bell_muted", "council_school_v1", "council_focus_table", "council_seat_locked",
    "council_kata_v1", "council_class_v1", "council_last_mode"
  ];

  function migrateLegacy() {
    LEGACY.forEach(function (name) {
      if (cache[name] != null) {
        putIdb(name, cache[name]);
        return;
      }
      var v = seedFromLocal(name);
      if (v != null) {
        cache[name] = v;
        putIdb(name, v);
      }
    });
  }

  try { openDb(); } catch (e) { readyResolve(false); }

  function wireSummon() {
    var btn = document.getElementById("passwordSubmit");
    var hit = document.getElementById("gateSummonHit");
    if (!btn || btn.__seatWired) return;
    btn.__seatWired = true;
    btn.disabled = false;
    btn.removeAttribute("disabled");
    btn.setAttribute("aria-disabled", "false");
    function go(e) {
      if (e) e.preventDefault();
      if (go.busy || window.__councilUnlockInFlight) return;
      var agree = document.getElementById("gateAgree");
      var err = document.getElementById("passwordError");
      if (agree && !agree.checked) {
        if (err) { err.textContent = "Check the oath first."; err.classList.remove("hidden"); }
        return;
      }
      go.busy = true;
      window.__councilUnlockInFlight = true;
      fetch("/api/desk/unlock", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oath: true })
      }).then(function (r) { return r.json().then(function (d) { return { ok: r.ok && d && d.ok }; }).catch(function () { return { ok: false }; }); }).then(function (res) {
        if (!res.ok) {
          if (err) { err.textContent = "Couldn't open the desk. Try again."; err.classList.remove("hidden"); }
          return;
        }
        try { sessionStorage.setItem("council_auth_ok", "1"); } catch (e2) {}
        try { localStorage.setItem("council_onboarded", "1"); } catch (e2) {}
        lockSeat();
      }).catch(function () {
        if (err) { err.textContent = "Couldn't open the desk. Try again."; err.classList.remove("hidden"); }
      }).finally(function () { go.busy = false; window.__councilUnlockInFlight = false; });
    }
    btn.addEventListener("click", go, true);
    if (hit) hit.addEventListener("click", go, true);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wireSummon);
  } else {
    wireSummon();
  }

  function wireMoreMenu() {
    if (document.__seatMoreWired) return;
    var moreBtn = document.getElementById("moreBtn");
    var moreMenu = document.getElementById("moreMenu");
    if (!moreBtn || !moreMenu) return;
    document.__seatMoreWired = true;
    function placeMenu() {
      var r = moreBtn.getBoundingClientRect();
      moreMenu.style.top = Math.round(r.bottom + 6) + "px";
      moreMenu.style.right = Math.max(8, Math.round(window.innerWidth - r.right)) + "px";
      moreMenu.style.left = "auto";
    }
    moreBtn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      var open = moreMenu.hidden;
      if (open) placeMenu();
      moreMenu.hidden = !open;
      moreBtn.setAttribute("aria-expanded", open ? "true" : "false");
    });
    document.addEventListener("click", function (e) {
      if (moreMenu.hidden) return;
      if (e.target === moreBtn || moreBtn.contains(e.target) || moreMenu.contains(e.target)) return;
      moreMenu.hidden = true;
      moreBtn.setAttribute("aria-expanded", "false");
    });
  }

  function wireDeskClicks() {
    if (document.__deskClicksWired) return;
    document.__deskClicksWired = true;
    document.addEventListener("click", function (e) {
      var t = e.target && e.target.closest && e.target.closest("button, [data-mode], [data-focus]");
      if (!t) return;
      if (document.body && document.body.classList.contains("gate-locked") && isLocked()) {
        paintUnlocked();
      }
      if (t.id === "moreBtn" || t.classList.contains("mode-more-btn")) return;
      if (t.classList && t.classList.contains("mode-tab") && t.getAttribute("data-mode")) {
        var mode = t.getAttribute("data-mode");
        if (typeof w.setMode === "function") {
          try { w.setMode(mode); } catch (err) { fallbackSetMode(mode); }
        } else {
          fallbackSetMode(mode);
        }
      }
      if (t.classList && t.classList.contains("focus-tab") && t.getAttribute("data-focus")) {
        if (typeof w.setFocusTable === "function") {
          try { w.setFocusTable(t.getAttribute("data-focus")); } catch (err) {}
        }
      }
    }, false);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      if (isLocked()) paintUnlocked();
      wireDeskClicks();
      wireMoreMenu();
    });
  } else {
    if (isLocked()) paintUnlocked();
    wireDeskClicks();
    wireMoreMenu();
  }

  w.CouncilSeat = {
    id: seatId,
    key: lsKey,
    get: get,
    set: set,
    getJson: getJson,
    setJson: setJson,
    isLocked: isLocked,
    lockSeat: lockSeat,
    ready: ready,
    backend: "indexeddb"
  };

  if (!document.getElementById("layoutCleanupCss")) {
    var lc = document.createElement("link");
    lc.id = "layoutCleanupCss";
    lc.rel = "stylesheet";
    lc.href = "/static/layout-cleanup.css?v=20260830s";
    (document.head || document.documentElement).appendChild(lc);
  }

  function loadScript(flag, src) {
    if (w[flag]) return;
    w[flag] = true;
    var tag = document.createElement("script");
    tag.src = src;
    tag.async = false;
    (document.head || document.documentElement).appendChild(tag);
  }
  loadScript("__focusTableScript", "/static/focus-table.js?v=20260830q");
  loadScript("__watchLoopScript", "/static/watch-loop.js?v=20260830q");
  loadScript("__phoneNavScript", "/static/phone-nav.js?v=20260830s");
})(window);
