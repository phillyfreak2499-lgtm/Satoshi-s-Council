/* Per-browser seat. School, Dojo, paper, join, sfx live here.
   Admin / Chair brain stays on the server. Not one shared locker. */
(function (w) {
  const ID_KEY = "council_seat_id";
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
  function key(name) { return "seat:" + seatId() + ":" + name; }
  function get(name) {
    try {
      var v = localStorage.getItem(key(name));
      if (v != null) return v;
      var old = localStorage.getItem(name);
      if (old != null) {
        localStorage.setItem(key(name), old);
        return old;
      }
    } catch (e) {}
    return null;
  }
  function set(name, val) {
    try { localStorage.setItem(key(name), String(val)); } catch (e) {}
  }
  function getJson(name, fallback) {
    try {
      var r = get(name);
      if (!r) return fallback;
      return JSON.parse(r);
    } catch (e) { return fallback; }
  }
  function setJson(name, obj) {
    try { set(name, JSON.stringify(obj)); } catch (e) {}
  }
  function isLocked() {
    try {
      if (localStorage.getItem("council_seat_locked") === "1") return true;
      return get("council_seat_locked") === "1";
    } catch (e) { return false; }
  }
  function lockSeat() {
    try { localStorage.setItem("council_seat_locked", "1"); } catch (e) {}
    set("council_seat_locked", "1");
    set("council_onboarded", "1");
    set("council_entered", "1");
  }
  w.CouncilSeat = { id: seatId, key: key, get: get, set: set, getJson: getJson, setJson: setJson, isLocked: isLocked, lockSeat: lockSeat };
})(window);
