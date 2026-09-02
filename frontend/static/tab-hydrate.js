/* Fill info tabs from their own desk-session routes.
 * Does not thicken /api/state. Safe to load after roundtable.js + desk-fx.js.
 */
(function (w) {
  "use strict";
  if (w.__tabHydrateLoaded) return;
  w.__tabHydrateLoaded = true;

  var VIEW_IDS = {
    settings: "settingsView",
    seats: "seatsView",
    paper: "paperView",
    calls: "callsView",
    tape: "tapeView",
    book: "bookView",
    brain: "brainView",
    night: "brainView",
    news: "newsView",
    wire: "wireView",
    school: "schoolView",
    charts: "chartsView",
    side: "sideView",
    front: "frontView",
    room: "roomView"
  };
  var lastMode = "";
  var lastAt = 0;

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function emptyNote(el, text) {
    if (!el) return;
    el.innerHTML = '<p class="tab-empty">' + esc(text) + "</p>";
  }
  function listOrEmpty(el, items, render, emptyText) {
    if (!el) return;
    if (!items || !items.length) { emptyNote(el, emptyText); return; }
    el.innerHTML = items.map(render).join("");
  }
  function getJson(url) {
    return fetch(url, { credentials: "include", headers: { Accept: "application/json" } })
      .then(function (r) {
        if (r.status === 401) throw new Error("desk");
        return r.json().catch(function () { return {}; });
      });
  }

  function showView(mode) {
    if (mode === "night") mode = "brain";
    var body = document.body;
    if (!body) return mode;
    body.className = String(body.className || "").replace(/\bmode-[a-z0-9_-]+/g, "").trim();
    body.classList.add("mode-" + mode);
    document.querySelectorAll(".info-view, .charts-view").forEach(function (v) {
      if (VIEW_IDS[mode] && v.id === VIEW_IDS[mode]) return;
      v.classList.add("hidden");
      v.setAttribute("hidden", "");
    });
    var id = VIEW_IDS[mode];
    if (id) {
      var panel = $(id);
      if (panel) {
        panel.classList.remove("hidden");
        panel.removeAttribute("hidden");
      }
    }
    document.querySelectorAll(".mode-tab[data-mode]").forEach(function (b) {
      var on = b.getAttribute("data-mode") === mode || (mode === "brain" && b.getAttribute("data-mode") === "night");
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    return mode;
  }

  function paintRoster(data) {
    var grid = $("botsGrid");
    if (!grid) return;
    var mains = (data && data.mains) || {};
    var keys = Object.keys(mains).filter(function (k) { return k !== "chair" && k !== "leader" && k !== "candle"; });
    if (!keys.length) { emptyNote(grid, "No seats on the roster yet."); return; }
    grid.innerHTML = keys.map(function (k) {
      var row = mains[k] || {};
      return '<article class="bot-card" data-agent="' + esc(k) + '">' +
        '<b>' + esc(row.display_name || k) + '</b>' +
        '<span>' + esc(row.title || "") + '</span></article>';
    }).join("");
  }

  function paintRanks(data) {
    var table = $("ranksTable");
    if (!table) return;
    var rows = (data && (data.ranks || data.rows)) || [];
    if (!rows.length) { emptyNote(table, "Rank board is still collecting graded calls."); return; }
    table.innerHTML = '<div class="ranks-row ranks-head"><span>#</span><span>SEAT</span><span>HIT</span><span>MISS</span><span>WR%</span><span>LISTEN</span></div>' +
      rows.slice(0, 24).map(function (r, i) {
        var name = r.display_name || r.agent || r.name || r.seat || "";
        var wr = r.win_rate != null ? Math.round(Number(r.win_rate) * (Number(r.win_rate) <= 1 ? 100 : 1)) : "—";
        return '<div class="ranks-row"><span>' + esc(r.rank || (i + 1)) + '</span><span>' +
          esc(name) + '</span><span>' + esc(r.hits || r.correct || r.hit || "—") +
          '</span><span>' + esc(r.misses || r.wrong || r.miss || "—") +
          '</span><span>' + esc(wr) + '</span><span>' + esc(r.listen != null ? r.listen : (r.weight || "—")) +
          '</span></div>';
      }).join("");
  }

  function paintBook(data) {
    function side(elId, flagId, row, label) {
      var body = $(elId), flag = $(flagId);
      if (flag) flag.textContent = (row && row.flag) || (row && row.book_state) || "—";
      if (!body) return;
      if (!row) { body.textContent = label + " book is dark."; return; }
      body.innerHTML =
        '<p>' + esc(row.window || label) + '</p>' +
        '<p>YES ' + esc(row.yes_bid != null ? row.yes_bid + "¢" : "—") +
        ' / ' + esc(row.yes_ask != null ? row.yes_ask + "¢" : "—") + '</p>' +
        '<p>NO ' + esc(row.no_bid != null ? row.no_bid + "¢" : "—") +
        ' / ' + esc(row.no_ask != null ? row.no_ask + "¢" : "—") + '</p>' +
        '<p>' + esc(row.flag || row.book_state || "ok") + '</p>';
    }
    side("bookBtcBody", "bookBtcFlag", data && data.satoshi, "SATOSHI");
    side("bookEthBody", "bookEthFlag", data && data.vitalik, "VITALIK");
  }

  function paintTape(data) {
    var meta = $("tapeMeta");
    var table = $("tapeTable");
    if (meta) meta.textContent = data && data.note ? data.note : "last 24h";
    var rows = (data && data.rows) || [];
    if (!table) return;
    if (!rows.length) { emptyNote(table, data && data.empty ? "No Chair tape in the last 24 hours." : "Tape is empty."); return; }
    table.innerHTML = rows.slice(0, 40).map(function (r) {
      return '<div class="tape-row ' + esc(r.result || "") + '"><span>' + esc(r.window) +
        '</span><span>' + esc((r.asset || "").toUpperCase()) + '</span><span>' + esc(r.side) +
        '</span><span>' + esc(r.result) + '</span></div>';
    }).join("");
  }

  function paintBrain(data) {
    var head = $("brainHeadline");
    if (head) head.textContent = (data && data.headline) || "No huddle recap yet";
    function items(id, rows, key) {
      listOrEmpty($(id), rows, function (r) {
        var label = typeof r === "string" ? r : (r.seat || r.note || r);
        return '<li>' + esc(label) + (r && r.note && r.seat ? ' · ' + esc(r.note) : "") + '</li>';
      }, key === "louder" ? "No seats marked louder." : "No seats faded.");
    }
    items("brainLouder", data && data.louder, "louder");
    items("brainFaded", data && data.faded, "faded");
    var notes = $("brainNotes");
    var extra = [].concat((data && data.went_well) || [], (data && data.went_poor) || [], (data && data.patterns) || []);
    listOrEmpty(notes, extra, function (n) { return '<li>' + esc(n) + '</li>'; }, (data && data.note) || "The nightly huddle has not written a report.");
    var sat = $("brainSatoshi");
    var vit = $("brainVitalik");
    if (sat) sat.textContent = data && data.satoshi ? ("SATOSHI · " + (data.satoshi.note || "—")) : "SATOSHI · —";
    if (vit) vit.textContent = data && data.vitalik ? ("VITALIK · " + (data.vitalik.note || "—")) : "VITALIK · —";
  }

  function paintNews(data) {
    function rail(id, rows, empty) {
      listOrEmpty($(id), rows, function (n) {
        var t = n.title || n.headline || n.text || n;
        return '<li>' + esc(t) + '</li>';
      }, empty);
    }
    rail("newsComing", data && (data.coming || data.upcoming || data.coming_up), "Nothing on the coming-up rail.");
    rail("newsBreaking", data && (data.breaking || data.headlines), "No breaking hour headlines.");
    var wire = $("wireList");
    if (wire) {
      var rows = (data && (data.breaking || data.coming || data.items)) || [];
      listOrEmpty(wire, rows, function (n) {
        return '<li>' + esc(n.title || n.headline || n.text || n) + '</li>';
      }, "WIRE is quiet.");
    }
  }

  function paintSchool(data) {
    var list = $("schoolList");
    var lessons = (data && (data.lessons || data.items || data.curriculum)) || [];
    if (Array.isArray(lessons) && lessons.length && typeof lessons[0] !== "object") {
      lessons = lessons.map(function (t) { return { title: t }; });
    }
    listOrEmpty(list, lessons, function (lsn) {
      return '<li><b>' + esc(lsn.title || lsn.name || "Lesson") + '</b> <span>' +
        esc(lsn.mins || lsn.minutes || "") + '</span></li>';
    }, "School lessons will land here.");
  }

  function paintCalls(data) {
    var host = $("callCards");
    var cards = (data && data.cards) || [];
    listOrEmpty(host, cards, function (c) {
      return '<article class="call-card"><b>' + esc((c.asset || "").toUpperCase()) +
        '</b> <span>' + esc(c.call || c.result || "WAIT") + '</span>' +
        '<small>' + esc(c.window || c.ticker || "") + '</small></article>';
    }, "No settled call cards yet. WAIT hours stay off this board.");
  }

  function paintSettings(acc) {
    if (!acc) return;
    var pct = acc.accuracy_pct != null ? acc.accuracy_pct : acc.pct;
    var el = $("setHrPct"); if (el) el.textContent = pct != null ? (Math.round(Number(pct)) + "%") : "—";
    var c = $("setHrCorrect"); if (c) c.textContent = acc.correct != null ? acc.correct : 0;
    var w = $("setHrWrong"); if (w) w.textContent = acc.wrong != null ? acc.wrong : 0;
    var t = $("setHrTotal"); if (t) t.textContent = acc.total != null ? acc.total : 0;
    var line = $("setHrLine"); if (line) line.textContent = "Finish-only graded calls. Not a promise about the next hour.";
  }

  function paintDark(id, name) {
    var el = $(id);
    if (!el) return;
    if (el.dataset.darkPainted === "1") return;
    var note = document.createElement("p");
    note.className = "tab-empty";
    note.textContent = name + " is WATCH · not live yet. Bitcoin desk only.";
    el.insertBefore(note, el.firstChild);
    el.dataset.darkPainted = "1";
  }

  function hydrate(mode) {
    mode = showView(mode || "art");
    var now = Date.now();
    if (mode === lastMode && now - lastAt < 1500) return;
    lastMode = mode;
    lastAt = now;
    var fail = function (msg) {
      return function () {
        var id = VIEW_IDS[mode];
        var panel = id && $(id);
        if (panel && !panel.querySelector(".tab-empty")) emptyNote(panel.querySelector(".book-body, .bots-grid, .ranks-table, .tape-table, .news-list, .wire-list, .school-list, .call-cards, .brain-notes") || panel, msg);
      };
    };
    if (mode === "seats") {
      getJson("/api/roster").then(paintRoster).catch(fail("Unlock the desk to load the field guide."));
      getJson("/api/council/ranks").then(paintRanks).catch(fail("Rank board needs a desk session."));
    } else if (mode === "book") {
      getJson("/api/book").then(paintBook).catch(fail("Book needs a desk session."));
    } else if (mode === "tape") {
      getJson("/api/tape").then(paintTape).catch(fail("Tape needs a desk session."));
    } else if (mode === "brain") {
      getJson("/api/brain/recap").then(paintBrain).catch(fail("Brain needs a desk session."));
    } else if (mode === "news" || mode === "wire") {
      getJson("/api/news").then(paintNews).catch(fail("News needs a desk session."));
    } else if (mode === "school") {
      getJson("/api/school").then(paintSchool).catch(fail("School needs a desk session."));
    } else if (mode === "calls") {
      getJson("/api/journal/cards").then(paintCalls).catch(fail("Call cards need a desk session."));
    } else if (mode === "settings") {
      getJson("/api/accuracy").then(paintSettings).catch(function () {});
    } else if (mode === "room") {
      try { if (w.CouncilRoom && typeof w.CouncilRoom.start === "function") w.CouncilRoom.start(); } catch (e) {}
    } else if (mode === "front") {
      getJson("/api/front").then(function () { paintDark("frontView", "THE FRONT"); }).catch(function () { paintDark("frontView", "THE FRONT"); });
    } else if (mode === "side") {
      getJson("/api/side").then(function () { paintDark("sideView", "SIDE TABLE"); }).catch(function () { paintDark("sideView", "SIDE TABLE"); });
    }
  }

  function wrapSetMode() {
    var prev = w.setMode;
    if (prev && prev.__tabHydrateWrapped) return;
    var wrapped = function (mode) {
      var mapped = mode === "night" ? "brain" : mode;
      try {
        if (prev && !prev.__tabHydrateWrapped) prev(mapped === "brain" && mode === "night" ? "brain" : mapped);
        else if (w.__deskSetModeFallback) w.__deskSetModeFallback(mapped);
      } catch (err) {
        try { if (w.__deskSetModeFallback) w.__deskSetModeFallback(mapped); } catch (e2) {}
      }
      hydrate(mapped);
    };
    wrapped.__tabHydrateWrapped = true;
    w.setMode = wrapped;
    w.hydrateDeskTab = hydrate;
  }

  function boot() {
    wrapSetMode();
    var body = document.body;
    if (!body) return;
    var m = (body.className.match(/\bmode-([a-z0-9_-]+)/) || [])[1];
    if (m && m !== "art" && m !== "stream" && m !== "floor") hydrate(m);
  }
  wrapSetMode();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
  setTimeout(wrapSetMode, 0);
  setTimeout(wrapSetMode, 400);
})(window);
