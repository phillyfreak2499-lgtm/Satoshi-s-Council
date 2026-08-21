/* Per-browser seat in IndexedDB.
   School, Dojo, paper, join, last tab live on THIS device.
   localStorage only mirrors the lock flag so the gate can skip on a cold load.
   Admin / Chair brain stays on the server. */
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
    var wrap = document.getElementById("summonVideoWrap");
    if (wrap) wrap.classList.remove("active");
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
      if (e) {
        e.preventDefault();
      }
      if (go.busy) return;
      var agree = document.getElementById("gateAgree");
      var err = document.getElementById("passwordError");
      if (agree && !agree.checked) {
        if (err) { err.textContent = "Check the oath first."; err.classList.remove("hidden"); }
        return;
      }
      go.busy = true;
      fetch("/api/desk/unlock", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oath: true })
      }).then(function (r) { return r.json().then(function (d) { return { ok: r.ok && d && d.ok }; }).catch(function () { return { ok: false }; }); }).then(function (res) {
        if (!res.ok) {
          if (err) { err.textContent = "Oath failed. Try again."; err.classList.remove("hidden"); }
          return;
        }
        try { sessionStorage.setItem("council_auth_ok", "1"); } catch (e2) {}
        try { localStorage.setItem("council_onboarded", "1"); } catch (e2) {}
        lockSeat();
      }).catch(function () {
        if (err) { err.textContent = "Oath failed. Try again."; err.classList.remove("hidden"); }
      }).finally(function () { go.busy = false; });
    }
    btn.addEventListener("click", go, true);
    if (hit) hit.addEventListener("click", go, true);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wireSummon);
  } else {
    wireSummon();
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
      if (t.classList && t.classList.contains("mode-tab") && t.getAttribute("data-mode")) {
        if (typeof w.setMode === "function") {
          try { w.setMode(t.getAttribute("data-mode")); } catch (err) {}
        }
      }
      if (t.classList && t.classList.contains("focus-tab") && t.getAttribute("data-focus")) {
        if (typeof w.setFocusTable === "function") {
          try { w.setFocusTable(t.getAttribute("data-focus")); } catch (err) {}
        } else if (typeof w.setMode === "function") {
          try { w.setMode("art"); } catch (err) {}
        }
      }
    }, false);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      if (isLocked()) paintUnlocked();
      wireDeskClicks();
    });
  } else {
    if (isLocked()) paintUnlocked();
    wireDeskClicks();
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
})(window);
