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

  function lockSeat() {
    set("council_seat_locked", "1");
    set("council_onboarded", "1");
    set("council_entered", "1");
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
