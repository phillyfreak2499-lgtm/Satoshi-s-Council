/* Session windows — America/New_York wall clock (matches listed EST times through DST). */
(function () {
  "use strict";

  var NY = "America/New_York";

  var WINDOWS = [
    {
      id: "ny_am",
      name: "NY MORNING",
      grade: "best",
      note: "Best price movement",
      start: 9 * 60 + 30,
      end: 11 * 60 + 30,
      cst: "8:30–10:30 AM",
      est: "9:30–11:30 AM",
    },
    {
      id: "lunch",
      name: "LUNCH",
      grade: "alright",
      note: "Movement is alright",
      start: 11 * 60 + 30,
      end: 14 * 60,
      cst: "10:30 AM–1:00 PM",
      est: "11:30 AM–2:00 PM",
    },
    {
      id: "afternoon",
      name: "AFTERNOON",
      grade: "worse",
      note: "Usually worse",
      start: 15 * 60,
      end: 16 * 60,
      cst: "2:00–3:00 PM",
      est: "3:00–4:00 PM",
    },
    {
      id: "asia",
      name: "ASIA / JAPAN",
      grade: "good",
      note: "Japan usually moves nicely",
      start: 20 * 60,
      end: 23 * 60,
      cst: "7:00–10:00 PM",
      est: "8:00–11:00 PM",
    },
    {
      id: "london",
      name: "LONDON",
      grade: "okay",
      note: "Movement is okay",
      start: 1 * 60,
      end: 4 * 60,
      cst: "12:00–3:00 AM",
      est: "1:00–4:00 AM",
    },
  ];

  function partsIn(tz) {
    var fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
      weekday: "short",
    });
    var map = {};
    fmt.formatToParts(new Date()).forEach(function (p) {
      if (p.type !== "literal") map[p.type] = p.value;
    });
    return map;
  }

  function minutesNow() {
    var p = partsIn(NY);
    return Number(p.hour) * 60 + Number(p.minute);
  }

  function inWindow(w, mins) {
    if (w.start <= w.end) return mins >= w.start && mins < w.end;
    return mins >= w.start || mins < w.end;
  }

  function activeWindows(mins) {
    return WINDOWS.filter(function (w) {
      return inWindow(w, mins);
    });
  }

  function nextWindow(mins) {
    var best = null;
    var bestWait = 1e9;
    WINDOWS.forEach(function (w) {
      var wait = w.start - mins;
      if (wait <= 0) wait += 24 * 60;
      if (wait < bestWait) {
        bestWait = wait;
        best = w;
      }
    });
    return { win: best, wait: bestWait };
  }

  function fmtMins(m) {
    var h = Math.floor(m / 60);
    var min = m % 60;
    if (h <= 0) return min + "m";
    if (min === 0) return h + "h";
    return h + "h " + min + "m";
  }

  function pick(list) {
    var rank = { best: 0, good: 1, alright: 2, okay: 3, worse: 4 };
    list.sort(function (a, b) {
      return (rank[a.grade] || 9) - (rank[b.grade] || 9);
    });
    return list[0] || null;
  }

  function leftIn(w, mins) {
    if (w.start <= w.end) return w.end - mins;
    if (mins >= w.start) return 24 * 60 - mins + w.end;
    return w.end - mins;
  }

  function renderPanel() {
    var box = document.getElementById("sessionPanel");
    if (!box) return;
    var mins = minutesNow();
    box.innerHTML = WINDOWS.map(function (w) {
      var on = inWindow(w, mins);
      return (
        '<div class="session-row' +
        (on ? " on grade-" + w.grade : "") +
        '">' +
        "<b>" +
        w.name +
        "</b>" +
        "<span>" +
        w.note +
        "</span>" +
        "<small>CST " +
        w.cst +
        " · EST " +
        w.est +
        "</small>" +
        "</div>"
      );
    }).join("");
  }

  function tick() {
    var chip = document.getElementById("sessionChip");
    var nameEl = document.getElementById("sessionName");
    var noteEl = document.getElementById("sessionNote");
    var leftEl = document.getElementById("sessionLeft");
    if (!chip || !nameEl) return;

    var mins = minutesNow();
    var on = pick(activeWindows(mins));
    var next = nextWindow(mins);
    var leftTxt = "";
    var noteTxt = "";
    var titleTxt = "";

    chip.className = "session-chip " + (on ? "grade-" + on.grade : "off");
    chip.dataset.session = on ? on.id : "off";
    document.body.dataset.session = on ? on.id : "off";
    document.body.dataset.sessionGrade = on ? on.grade : "off";

    if (on) {
      nameEl.textContent = on.name;
      noteTxt = on.note;
      leftTxt = fmtMins(leftIn(on, mins)) + " left";
      titleTxt = on.name + " · " + on.note + " · " + leftTxt;
    } else {
      nameEl.textContent = "OFF SESSION";
      noteTxt = next.win ? "Next " + next.win.name : "quiet tape";
      leftTxt = next.win ? "in " + fmtMins(next.wait) : "";
      titleTxt = noteTxt + (leftTxt ? " · " + leftTxt : "");
    }
    if (noteEl) noteEl.textContent = noteTxt;
    if (leftEl) leftEl.textContent = leftTxt;
    chip.title = titleTxt || "Best trading times";
    chip.setAttribute("aria-label", titleTxt || "Session window");
    renderPanel();
  }

  function bind() {
    var chip = document.getElementById("sessionChip");
    var panel = document.getElementById("sessionPanel");
    if (!chip || !panel) return;
    chip.addEventListener("click", function () {
      var open = panel.hasAttribute("hidden");
      if (open) panel.removeAttribute("hidden");
      else panel.setAttribute("hidden", "");
      chip.setAttribute("aria-expanded", open ? "true" : "false");
    });
    document.addEventListener("click", function (e) {
      if (!chip.contains(e.target) && !panel.contains(e.target)) {
        panel.setAttribute("hidden", "");
        chip.setAttribute("aria-expanded", "false");
      }
    });
  }

  function inject() {
    if (document.getElementById("sessionChip")) return;
    var clock = document.getElementById("liveClock");
    var host = (clock && clock.parentNode) || document.querySelector("header .logo");
    if (!host) return;
    if (!document.querySelector("link[data-session-window]")) {
      var link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "/static/session-window.css?v=20260830n";
      link.setAttribute("data-session-window", "1");
      document.head.appendChild(link);
    }
    var wrap = document.createElement("div");
    wrap.className = "session-wrap";
    wrap.innerHTML =
      '<button type="button" id="sessionChip" class="session-chip off" aria-expanded="false" aria-controls="sessionPanel" title="Best trading times">' +
      '<span class="session-dot" aria-hidden="true"></span>' +
      '<span id="sessionName">OFF SESSION</span>' +
      '<span class="session-sep" aria-hidden="true">·</span>' +
      '<span id="sessionNote">quiet tape</span>' +
      '<span class="session-sep session-sep-left" aria-hidden="true">·</span>' +
      '<span id="sessionLeft" class="session-left"></span>' +
      "</button>" +
      '<div id="sessionPanel" class="session-panel" hidden></div>';
    if (clock && clock.nextSibling) host.insertBefore(wrap, clock.nextSibling);
    else host.appendChild(wrap);
  }

  function boot() {
    inject();
    if (!document.getElementById("sessionChip")) return;
    bind();
    tick();
    setInterval(tick, 15000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
